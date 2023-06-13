import {
    Uri,
    Command,
    EventEmitter,
    Event,
    scm,
    SourceControl,
    SourceControlResourceState,
    SourceControlResourceDecorations,
    Disposable,
    ProgressLocation,
    window,
    workspace,
    commands,
    RelativePattern,
} from 'vscode';
import {
    OpenedRepository,
    Commit,
    PullOptions,
    CommitDetails,
    TimelineOptions,
    FossilRoot,
    BranchDetails,
    FossilCheckin,
    FossilBranch,
    FossilTag,
    StatusString,
    MergeAction,
    FossilHash,
    FossilRemote,
    FossilRemoteName,
    FossilURI,
    FossilUndoCommand,
    FossilCommitMessage,
    StashItem,
    RelativePath,
    Praise,
    ResourceStatus,
    FossilStatus,
    FossilClass,
    AnyPath,
    UserPath,
} from './openedRepository';
import {
    anyEvent,
    filterEvent,
    eventToPromise,
    dispose,
    IDisposable,
    delay,
} from './util';
import { memoize, throttle, debounce } from './decorators';
import { StatusBarCommands } from './statusbar';
import typedConfig from './config';

import * as path from 'path';
import {
    FossilResourceGroup,
    createEmptyStatusGroups,
    IStatusGroups,
    groupStatuses,
    IGroupStatusesParams,
} from './resourceGroups';
import {
    AutoInOutState,
    AutoInOutStatuses,
    AutoIncomingOutgoing,
} from './autoinout';
import * as interaction from './interaction';
import {
    InteractionAPI,
    NewBranchOptions,
    PushCreatesNewHeadAction,
} from './interaction';
import { FossilUriParams, toFossilUri } from './uri';
import { FossilError } from './fossilExecutable';

import { localize } from './main';
const iconsRootPath = path.join(path.dirname(__dirname), 'resources', 'icons');

type AvailableIcons =
    | 'status-added'
    | 'status-clean'
    | 'status-conflict'
    | 'status-deleted'
    | 'status-ignored'
    | 'status-missing'
    | 'status-modified'
    | 'status-renamed'
    | 'status-untracked';

function getIconUri(iconName: AvailableIcons, theme: 'dark' | 'light'): Uri {
    return Uri.file(path.join(iconsRootPath, theme, `${iconName}.svg`));
}

export interface LogEntriesOptions
    extends Omit<TimelineOptions, 'filePath' | 'limit'> {
    readonly fileUri?: Uri;
    readonly limit?: TimelineOptions['limit'];
}

export const enum RepositoryState {
    Idle,
    Disposed,
}

type ThemeName = 'light' | 'dark';

export class FossilResource implements SourceControlResourceState {
    @memoize
    get command(): Command {
        return {
            command: 'fossil.openResource',
            title: localize('open', 'Open'),
            arguments: [this],
        };
    }

    get isDirtyStatus(): boolean {
        switch (this.status) {
            case ResourceStatus.EXTRA:
                return false;

            case ResourceStatus.ADDED:
            case ResourceStatus.DELETED:
            case ResourceStatus.MISSING:
            case ResourceStatus.MODIFIED:
            case ResourceStatus.RENAMED:
            case ResourceStatus.CONFLICT:
            default:
                return true;
        }
    }

    get original(): Uri {
        return this._resourceUri;
    }
    get renameResourceUri(): Uri | undefined {
        return this._renameResourceUri;
    }
    @memoize
    get resourceUri(): Uri {
        if (this.renameResourceUri) {
            if (
                this.status === ResourceStatus.MODIFIED ||
                this.status === ResourceStatus.RENAMED ||
                this.status === ResourceStatus.ADDED ||
                this.status === ResourceStatus.CONFLICT
            ) {
                return this.renameResourceUri;
            }

            throw new Error(
                `Renamed resource with unexpected status: ${this.status}`
            );
        }
        return this._resourceUri;
    }

    private static Icons: {
        [key in ThemeName]: { [key in ResourceStatus]: Uri };
    } = {
        light: {
            [ResourceStatus.MODIFIED]: getIconUri('status-modified', 'light'),
            [ResourceStatus.MISSING]: getIconUri('status-missing', 'light'),
            [ResourceStatus.ADDED]: getIconUri('status-added', 'light'),
            [ResourceStatus.DELETED]: getIconUri('status-deleted', 'light'),
            [ResourceStatus.RENAMED]: getIconUri('status-renamed', 'light'),
            [ResourceStatus.EXTRA]: getIconUri('status-untracked', 'light'),
            [ResourceStatus.CONFLICT]: getIconUri('status-conflict', 'light'),
        },
        dark: {
            [ResourceStatus.MODIFIED]: getIconUri('status-modified', 'dark'),
            [ResourceStatus.MISSING]: getIconUri('status-missing', 'dark'),
            [ResourceStatus.ADDED]: getIconUri('status-added', 'dark'),
            [ResourceStatus.DELETED]: getIconUri('status-deleted', 'dark'),
            [ResourceStatus.RENAMED]: getIconUri('status-renamed', 'dark'),
            [ResourceStatus.EXTRA]: getIconUri('status-untracked', 'dark'),
            [ResourceStatus.CONFLICT]: getIconUri('status-conflict', 'dark'),
        },
    };

    private getIconPath(theme: ThemeName): Uri {
        return FossilResource.Icons[theme][this.status];
    }

    get contextValue(): string | undefined {
        if (this.status == ResourceStatus.MISSING) {
            return 'MISSING';
        }
        return;
    }

    get decorations(): SourceControlResourceDecorations {
        const light = { iconPath: this.getIconPath('light') };
        const dark = { iconPath: this.getIconPath('dark') };

        return {
            strikeThrough: this.status == ResourceStatus.DELETED,
            light,
            dark,
            tooltip: this._tooltip,
        };
    }

    constructor(
        public resourceGroup: FossilResourceGroup,
        private readonly _resourceUri: Uri,
        public readonly status: ResourceStatus,
        private readonly _tooltip: FossilClass,
        private readonly _renameResourceUri?: Uri
    ) {}
}

export const enum Operation {
    Add,
    Branch,
    Clean,
    Close,
    Commit,
    Forget,
    Ignore,
    Init,
    Merge,
    PatchApply,
    PatchCreate,
    Pull,
    Push,
    Rename,
    Resolve,
    Revert,
    RevertFiles,
    Show,
    Stage,
    Status,
    Sync,
    Undo,
    UndoDryRun,
    Update,
}

function isReadOnly(operation: Operation): boolean {
    return [
        Operation.Show,
        // ToDo: make readonly, 'fossil.refresh' doesn't allow it yet...
        // Operation.Status
        Operation.Stage,
        Operation.UndoDryRun,
    ].includes(operation);
}

export const enum CommitScope {
    UNKNOWN, // try STAGING_GROUP, but if none, try WORKING_GROUP
    ALL, // don't use file from any group, useful for merge commit
    STAGING_GROUP,
    WORKING_GROUP,
}

export interface CommitOptions {
    readonly scope: CommitScope;
    readonly useBranch?: boolean;
}

export class Repository implements IDisposable, InteractionAPI {
    private _onDidChangeRepository = new EventEmitter<Uri>();
    readonly onDidChangeRepository: Event<Uri> =
        this._onDidChangeRepository.event;

    private _onDidChangeState = new EventEmitter<RepositoryState>();
    readonly onDidChangeState: Event<RepositoryState> =
        this._onDidChangeState.event;

    private _onDidChangeStatus = new EventEmitter<void>();
    readonly onDidChangeStatus: Event<void> = this._onDidChangeStatus.event;

    private _onDidChangeInOutState = new EventEmitter<void>();
    readonly onDidChangeInOutState: Event<void> =
        this._onDidChangeInOutState.event;

    private _onDidChangeResources = new EventEmitter<void>();
    readonly onDidChangeResources: Event<void> =
        this._onDidChangeResources.event;

    @memoize
    get onDidChange(): Event<void> {
        return anyEvent<any>(
            this.onDidChangeState,
            this.onDidChangeResources,
            this.onDidChangeInOutState
        );
    }

    private _onDidChangeOriginalResource = new EventEmitter<Uri>();
    readonly onDidChangeOriginalResource: Event<Uri> =
        this._onDidChangeOriginalResource.event;

    private _onRunOperation = new EventEmitter<Operation>();
    readonly onRunOperation: Event<Operation> = this._onRunOperation.event;

    private _onDidRunOperation = new EventEmitter<Operation>();
    readonly onDidRunOperation: Event<Operation> =
        this._onDidRunOperation.event;

    private _sourceControl: SourceControl;

    get sourceControl(): SourceControl {
        return this._sourceControl;
    }

    @memoize
    get onDidChangeOperations(): Event<void> {
        return anyEvent(
            this.onRunOperation as Event<any>,
            this.onDidRunOperation as Event<any>
        );
    }

    private _groups: IStatusGroups;
    get conflictGroup(): FossilResourceGroup {
        return this._groups.conflict;
    }
    get stagingGroup(): FossilResourceGroup {
        return this._groups.staging;
    }
    get workingGroup(): FossilResourceGroup {
        return this._groups.working;
    }
    get untrackedGroup(): FossilResourceGroup {
        return this._groups.untracked;
    }

    private _currentBranch: FossilBranch | undefined;
    get currentBranch(): FossilBranch | undefined {
        return this._currentBranch;
    }

    // ToDo: rename and possibly make non optional
    private _fossilStatus: FossilStatus | undefined;
    get fossilStatus(): FossilStatus | undefined {
        return this._fossilStatus;
    }

    private _operations = new Set<Operation>();
    get operations(): Set<Operation> {
        return this._operations;
    }

    private _autoInOutState: AutoInOutState = {
        status: AutoInOutStatuses.Disabled,
    };
    get autoInOutState(): AutoInOutState {
        return this._autoInOutState;
    }

    public changeAutoInoutState(state: Partial<AutoInOutState>): void {
        this._autoInOutState = {
            ...this._autoInOutState,
            ...state,
        };
        this._onDidChangeInOutState.fire();
    }

    get repoName(): string {
        return path.basename(this.repository.root);
    }

    get isClean(): boolean {
        const groups = [
            this.workingGroup,
            this.conflictGroup,
            this.stagingGroup,
        ];
        return groups.every(g => g.resourceStates.length === 0);
    }

    toUri(rawPath: string): Uri {
        return Uri.file(path.join(this.repository.root, rawPath));
    }

    private _state = RepositoryState.Idle;
    get state(): RepositoryState {
        return this._state;
    }
    set state(state: RepositoryState) {
        this._state = state;
        this._onDidChangeState.fire(state);

        this._currentBranch = undefined;
        this._groups.conflict.updateResources([]);
        this._groups.staging.updateResources([]);
        this._groups.untracked.updateResources([]);
        this._groups.working.updateResources([]);
        this._onDidChangeResources.fire();
    }

    get root(): FossilRoot {
        return this.repository.root;
    }

    private readonly disposables: Disposable[] = [];

    constructor(private readonly repository: OpenedRepository) {
        const repoRootWatcher = workspace.createFileSystemWatcher(
            new RelativePattern(repository.root, '**')
        );
        this.disposables.push(repoRootWatcher);

        const onRepositoryChange = anyEvent(
            repoRootWatcher.onDidChange,
            repoRootWatcher.onDidCreate,
            repoRootWatcher.onDidDelete
        );
        onRepositoryChange(this.onFSChange, this, this.disposables);

        const onCheckoutDatabaseChange = filterEvent(onRepositoryChange, uri =>
            /\/\.fslckout$/.test(uri.path)
        );
        onCheckoutDatabaseChange(
            this._onDidChangeRepository.fire,
            this._onDidChangeRepository,
            this.disposables
        );

        this._sourceControl = scm.createSourceControl(
            'fossil',
            'Fossil',
            Uri.file(repository.root)
        );
        this.disposables.push(this._sourceControl);

        this._sourceControl.acceptInputCommand = {
            command: 'fossil.commitWithInput',
            title: localize('commit', 'Commit'),
        };
        this._sourceControl.quickDiffProvider = this;

        const groups = createEmptyStatusGroups(this._sourceControl);

        this._groups = groups;
        this.disposables.push(
            ...Object.values(groups).map(
                (group: FossilResourceGroup) => group.disposable
            )
        );

        const statusBar = new StatusBarCommands(this);
        this.disposables.push(statusBar);
        statusBar.onDidChange(
            () => {
                this._sourceControl.statusBarCommands = statusBar.commands;
            },
            null,
            this.disposables
        );
        this._sourceControl.statusBarCommands = statusBar.commands;

        this.updateModelState('opening repository');

        this.disposables.push(new AutoIncomingOutgoing(this));
    }

    provideOriginalResource(uri: Uri): Uri | undefined {
        if (uri.scheme !== 'file') {
            return;
        }
        return toFossilUri(uri);
    }

    @throttle
    async status(reason: string): Promise<StatusString> {
        const statusPromise = this.repository.getStatus(reason);
        await this.runWithProgress(Operation.Status, () => statusPromise);
        this.updateInputBoxPlaceholder();
        return statusPromise;
    }

    private onFSChange(_uri: Uri): void {
        if (!typedConfig.autoRefresh) {
            return;
        }

        if (this.operations.size !== 0) {
            return;
        }

        this.eventuallyUpdateWhenIdleAndWait();
    }

    @debounce(1000)
    private eventuallyUpdateWhenIdleAndWait(): void {
        this.updateWhenIdleAndWait();
    }

    @throttle
    private async updateWhenIdleAndWait(): Promise<void> {
        await this.whenIdleAndFocused();
        await this.updateModelState('idle update');
        await delay(5000);
    }

    private updateInputBoxPlaceholder(): void {
        const branch = this.currentBranch;
        let placeholder: string;
        if (branch) {
            // '{0}' will be replaced by the corresponding key-command later in the process, which is why it needs to stay.
            placeholder = localize(
                'Message ({0} to commit on "{1}")',
                'Message ({0} to commit on "{1}")',
                '{0}',
                branch
            );
        } else {
            placeholder = localize(
                'Message ({0} to commit)',
                'Message ({0} to commit)'
            );
        }
        this._sourceControl.inputBox.placeholder = placeholder;
    }

    /**
     *  wait till all operations are complete and the window is in focus
     */
    async whenIdleAndFocused(): Promise<void> {
        while (true) {
            if (this.operations.size !== 0) {
                await eventToPromise(this.onDidRunOperation);
                continue;
            }

            if (!window.state.focused) {
                const onDidFocusWindow = filterEvent(
                    window.onDidChangeWindowState,
                    e => e.focused
                );
                await eventToPromise(onDidFocusWindow);
                continue;
            }

            return;
        }
    }

    @throttle
    async add(...uris: Uri[]): Promise<void> {
        let resources: FossilResource[];
        if (uris.length === 0) {
            resources = this._groups.untracked.resourceStates;
        } else {
            resources = this.mapResources(uris);
        }
        const relativePaths = resources.map(r =>
            this.mapResourceToRepoRelativePath(r)
        );
        await this.runWithProgress(Operation.Add, () =>
            this.repository.add(relativePaths)
        );
    }
    async ls(...uris: Uri[]): Promise<Uri[]> {
        const lsResult = await this.repository.ls(uris.map(url => url.fsPath));
        const rootUri = Uri.file(this.root);
        return lsResult.map(path => Uri.joinPath(rootUri, path));
    }

    @throttle
    async forget(...uris: Uri[]): Promise<void> {
        let resources: FossilResource[];
        if (uris.length === 0) {
            resources = this._groups.untracked.resourceStates;
        } else {
            resources = this.mapResources(uris);
        }
        const relativePaths = resources.map(r =>
            this.mapResourceToRepoRelativePath(r)
        );
        await this.runWithProgress(Operation.Forget, () =>
            this.repository.forget(relativePaths)
        );
    }

    async rename(
        oldPath: AnyPath,
        newPath: RelativePath | UserPath
    ): Promise<void> {
        await this.runWithProgress(Operation.Rename, () =>
            this.repository.rename(oldPath, newPath)
        );
    }

    @throttle
    async ignore(...uris: Uri[]): Promise<void> {
        let resources: FossilResource[];
        if (uris.length === 0) {
            resources = this._groups.untracked.resourceStates;
        } else {
            resources = this.mapResources(uris);
        }
        const relativePaths = resources.map(r =>
            this.mapResourceToRepoRelativePath(r)
        );
        await this.runWithProgress(Operation.Ignore, () =>
            this.repository.ignore(relativePaths)
        );
    }

    mapResources(resourceUris: Uri[]): FossilResource[] {
        const resources: FossilResource[] = [];
        const { conflict, working, untracked, staging } = this._groups;
        const groups = [working, staging, untracked, conflict];
        for (const uri of resourceUris) {
            for (const group of groups) {
                const resource = group.getResource(uri);
                if (resource) {
                    resources.push(resource);
                    break;
                }
            }
        }
        return resources;
    }

    @throttle
    async stage(...resourceUris: Uri[]): Promise<void> {
        await this.runWithProgress(Operation.Stage, async () => {
            let resources = this.mapResources(resourceUris);

            if (resources.length === 0) {
                resources = this._groups.working.resourceStates;
            }

            const missingResources = resources.filter(
                r => r.status === ResourceStatus.MISSING
            );

            if (missingResources.length) {
                const relativePaths = missingResources.map(r =>
                    this.mapResourceToRepoRelativePath(r)
                );
                await this.runWithProgress(Operation.Forget, () =>
                    this.repository.forget(relativePaths)
                );
            }

            const extraResources = resources.filter(
                r => r.status === ResourceStatus.EXTRA
            );

            if (extraResources.length) {
                const relativePaths = extraResources.map(r =>
                    this.mapResourceToRepoRelativePath(r)
                );
                await this.runWithProgress(Operation.Add, () =>
                    this.repository.add(relativePaths)
                );
                // after 'repository.add' resource statuses change, so:
                resources = this.mapResources(
                    resources.map(r => r.resourceUri)
                );
            }

            this._groups.staging.intersect(resources);
            this._groups.working.except(resources);
            this._onDidChangeResources.fire();
        });
    }

    // resource --> repo-relative path
    private mapResourceToRepoRelativePath(
        resource: FossilResource
    ): RelativePath {
        const relativePath = this.mapFileUriToRepoRelativePath(
            resource.resourceUri
        );
        return relativePath;
    }

    // file uri --> repo-relative path
    public mapFileUriToRepoRelativePath(fileUri: Uri): RelativePath {
        const relativePath = path
            .relative(this.repository.root, fileUri.fsPath)
            .replace(/\\/g, '/');
        return relativePath as RelativePath;
    }

    // resource --> workspace-relative path
    public mapResourceToWorkspaceRelativePath(
        resource: FossilResource
    ): RelativePath {
        const relativePath = this.mapFileUriToWorkspaceRelativePath(
            resource.resourceUri
        );
        return relativePath;
    }

    // file uri --> workspace-relative path
    public mapFileUriToWorkspaceRelativePath(fileUri: Uri): RelativePath {
        const relativePath = path
            .relative(this.repository.root, fileUri.fsPath)
            .replace(/[/\\]/g, path.sep);
        return relativePath as RelativePath;
    }

    @throttle
    async unstage(...uris: Uri[]): Promise<void> {
        let resources = this.mapResources(uris);
        if (resources.length === 0) {
            resources = this._groups.staging.resourceStates;
        }
        // const relativePaths: string[] = resources.map(r => this.mapResourceToRepoRelativePath(r));
        // await this.run(Operation.Remove, () => this.repository.revert(relativePaths));

        this._groups.staging.except(resources);
        this._groups.working.intersect(resources);
        this._onDidChangeResources.fire();
    }

    private scopeToFileList(
        scope: Exclude<CommitScope, CommitScope.UNKNOWN>
    ): RelativePath[] {
        if (scope === CommitScope.STAGING_GROUP) {
            return this.stagingGroup.resourceStates.map(r =>
                this.mapResourceToRepoRelativePath(r)
            );
        } else if (scope === CommitScope.WORKING_GROUP) {
            return this.workingGroup.resourceStates.map(r =>
                this.mapResourceToRepoRelativePath(r)
            );
        }
        return [];
    }

    @throttle
    async commit(
        message: FossilCommitMessage,
        scope: Exclude<CommitScope, CommitScope.UNKNOWN>,
        newBranch: NewBranchOptions | undefined
    ): Promise<void> {
        await this.runWithProgress(Operation.Commit, async () => {
            const user = typedConfig.username;
            const fileList = this.scopeToFileList(scope);
            await this.repository.commit(message, fileList, user, newBranch);
        });
    }

    @throttle
    async revert(...uris: Uri[]): Promise<void> {
        const resources = this.mapResources(uris);
        await this.runWithProgress(Operation.Revert, async () => {
            const toRevert: RelativePath[] = [];

            for (const r of resources) {
                switch (r.status) {
                    case ResourceStatus.EXTRA:
                        break;
                    default:
                        toRevert.push(this.mapResourceToRepoRelativePath(r));
                        break;
                }
            }

            const promises: Promise<void>[] = [];

            if (toRevert.length > 0) {
                promises.push(this.repository.revert(toRevert));
            }

            await Promise.all(promises);
        });
    }

    @throttle
    async cleanAll(): Promise<void> {
        await this.runWithProgress(Operation.Clean, async () => {
            this.repository.cleanAll();
        });
    }

    @throttle
    async clean(paths: string[]): Promise<void> {
        await this.runWithProgress(Operation.Clean, async () => {
            this.repository.clean(paths);
        });
    }

    @throttle
    async newBranch(newBranch: NewBranchOptions): Promise<void> {
        await this.runWithProgress(Operation.Branch, () =>
            this.repository.newBranch(newBranch)
        );
    }

    // @throttle
    async update(checkin: FossilCheckin): Promise<void> {
        await this.runWithProgress(Operation.Update, () =>
            this.repository.update(checkin)
        );
    }

    @throttle
    async close(): Promise<boolean> {
        const msg = await this.runWithProgress(Operation.Close, () =>
            this.repository.close()
        );
        if (msg) {
            interaction.warnUnsavedChanges(msg);
            return false;
        }
        return true;
    }

    async undoOrRedo<T extends boolean>(
        command: 'undo' | 'redo',
        dryRun: T
    ): Promise<T extends true ? FossilUndoCommand : undefined>;

    @throttle
    async undoOrRedo(
        command: 'undo' | 'redo',
        dryRun: boolean
    ): Promise<FossilUndoCommand | undefined> {
        const op = dryRun ? Operation.UndoDryRun : Operation.Undo;
        const undo = await this.runWithProgress(op, () =>
            this.repository.undoOrRedo(command, dryRun)
        );

        return undo;
    }

    private _isInAnyGroup(
        check: (group: FossilResourceGroup) => boolean
    ): boolean {
        return [this.workingGroup, this.stagingGroup, this.conflictGroup].some(
            check
        );
    }

    public isInAnyGroup(uri: Uri): boolean {
        return this._isInAnyGroup((group: FossilResourceGroup) =>
            group.includesUri(uri)
        );
    }

    public isDirInAnyGroup(uri: Uri): boolean {
        const dir = uri.toString() + path.sep;
        return this._isInAnyGroup((group: FossilResourceGroup) =>
            group.includesDir(dir)
        );
    }

    public async createPullOptions(): Promise<PullOptions> {
        return { autoUpdate: typedConfig.autoUpdate };
    }

    async changeInoutAfterDelay(delayMs = 3000): Promise<void> {
        try {
            // then confirm after delay
            if (delayMs) {
                await delay(delayMs);
            }
            this._onDidChangeInOutState.fire();
        } catch (err) {
            if (err instanceof FossilError) {
                this.changeAutoInoutState({
                    status: AutoInOutStatuses.Error,
                    error: (
                        (err.stderr || '').replace(/^abort:\s*/, '') ||
                        err.fossilErrorCode ||
                        err.message
                    ).trim(),
                });
            }
            throw err;
        }
    }

    @throttle
    async pull(options: PullOptions): Promise<void> {
        return this.runWithProgress(Operation.Pull, async () => {
            await this.repository.pull(options);
        });
    }

    @throttle
    async push(_path: FossilURI | undefined): Promise<void> {
        return this.runWithProgress(Operation.Push, async () => {
            try {
                await this.repository.push();
            } catch (e) {
                if (
                    e instanceof FossilError &&
                    e.fossilErrorCode === 'PushCreatesNewRemoteHead'
                ) {
                    const action = await interaction.warnPushCreatesNewHead();
                    if (action === PushCreatesNewHeadAction.Pull) {
                        commands.executeCommand('fossil.pull');
                    }
                    return;
                }

                throw e;
            }
        });
    }

    @throttle
    merge(checkin: FossilCheckin, mergeAction: MergeAction): Promise<void> {
        return this.runWithProgress(Operation.Merge, async () => {
            return this.repository.merge(checkin, mergeAction);
        });
    }

    addTag(branch: FossilBranch, tag: FossilTag): Promise<void> {
        return this.repository.addTag(branch, tag);
    }

    cancelTag(branch: FossilBranch, tag: FossilTag): Promise<void> {
        return this.repository.cancelTag(branch, tag);
    }

    async updateCommitMessage(
        checkin: FossilCheckin,
        commitMessage: FossilCommitMessage
    ): Promise<void> {
        return this.repository.updateCommitMessage(checkin, commitMessage);
    }

    async praise(path: string): Promise<Praise[]> {
        return this.repository.praise(path);
    }

    async info(checkin: FossilCheckin): Promise<{ [key: string]: string }> {
        return this.repository.info(checkin);
    }

    async show(params: FossilUriParams): Promise<string> {
        // TODO@Joao: should we make this a general concept?
        await this.whenIdleAndFocused();

        return this.runWithProgress(Operation.Show, async () => {
            const relativePath = path
                .relative(this.repository.root, params.path)
                .replace(/\\/g, '/') as RelativePath;
            try {
                return this.repository.cat(relativePath, params.checkin);
            } catch (e) {
                if (e instanceof FossilError) {
                    if (e.fossilErrorCode === 'NoSuchFile') {
                        return '';
                    }

                    if (e.exitCode !== 0) {
                        throw new FossilError({
                            ...e,
                            message: localize(
                                'cantshow',
                                'Could not show object'
                            ),
                        });
                    }
                }

                throw e;
            }
        });
    }

    async patchCreate(path: string): Promise<void> {
        return this.runWithProgress(Operation.PatchCreate, async () =>
            this.repository.patchCreate(path)
        );
    }

    async patchApply(path: string): Promise<void> {
        return this.runWithProgress(Operation.PatchApply, async () =>
            this.repository.patchApply(path)
        );
    }

    async stash(
        message: FossilCommitMessage,
        scope: Exclude<CommitScope, CommitScope.UNKNOWN>,
        operation: 'save' | 'snapshot'
    ): Promise<void> {
        return this.runWithProgress(Operation.Commit, async () => {
            const fileList = this.scopeToFileList(scope);
            this.repository.stash(message, operation, fileList);
        });
    }

    async stashList(): Promise<StashItem[]> {
        return this.runWithProgress(Operation.Status, async () =>
            this.repository.stashList()
        );
    }

    async stashPop(): Promise<void> {
        return this.runWithProgress(Operation.Status, async () =>
            this.repository.stashPop()
        );
    }

    async stashApplyOrDrop(
        operation: 'apply' | 'drop',
        stashId: number
    ): Promise<void> {
        return this.runWithProgress(Operation.Status, async () =>
            this.repository.stashApplyOrDrop(operation, stashId)
        );
    }

    private async runWithProgress<T>(
        operation: Operation,
        runOperation: () => Promise<T> = () => Promise.resolve<any>(null)
    ): Promise<T> {
        if (this.state !== RepositoryState.Idle) {
            throw new Error('Repository not initialized');
        }

        return window.withProgress(
            { location: ProgressLocation.SourceControl },
            async () => {
                this._operations = new Set<Operation>([
                    operation,
                    ...this._operations.values(),
                ]);
                this._onRunOperation.fire(operation);

                try {
                    const result = await runOperation();

                    if (!isReadOnly(operation)) {
                        try {
                            await this.updateModelState();
                        } catch (err) {
                            // expected to get here on executing `fossil close` operation
                            if (
                                err instanceof FossilError &&
                                err.fossilErrorCode === 'NotAFossilRepository'
                            ) {
                                this.state = RepositoryState.Disposed;
                            } else {
                                throw err;
                            }
                        }
                    }
                    return result;
                } catch (err) {
                    // we might get in this catch() when user deleted all files
                    if (
                        err instanceof FossilError &&
                        err.fossilErrorCode === 'NotAFossilRepository'
                    ) {
                        this.state = RepositoryState.Disposed;
                    }
                    throw err;
                } finally {
                    this._operations = new Set<Operation>(
                        this._operations.values()
                    );
                    this._operations.delete(operation);
                    this._onDidRunOperation.fire(operation);
                }
            }
        );
    }

    @throttle
    public async getPath(): Promise<FossilRemote> {
        try {
            const path = await this.repository.getRemotes();
            return path;
        } catch (e) {
            // noop
        }

        return {
            name: '' as FossilRemoteName,
            url: Uri.parse('') as FossilURI,
        };
    }

    @throttle
    public async getBranchesAndTags(): Promise<[BranchDetails[], FossilTag[]]> {
        const [branches, tags] = await Promise.all([
            this.repository.getBranches(),
            this.repository.getTags(),
        ]);
        const branchesSet = new Set<FossilCheckin>(
            branches.map(info => info.name)
        );
        // Exclude tags that are branches
        return [branches, tags.filter(tag => !branchesSet.has(tag))];
    }

    /** When user selects one of the modified files using 'fossil.log' command */
    async diffToParent(
        filePath: string,
        checkin: FossilCheckin
    ): Promise<void> {
        const uri = this.toUri(filePath);
        const parent: FossilCheckin = await this.getInfo(checkin, 'parent');
        const left = toFossilUri(uri, parent);
        const right = toFossilUri(uri, checkin);
        const baseName = path.basename(uri.fsPath);
        const title = `${baseName} (${parent.slice(0, 12)} vs. ${checkin.slice(
            0,
            12
        )})`;

        if (left && right) {
            return commands.executeCommand<void>(
                'vscode.diff',
                left,
                right,
                title
            );
        }
    }

    public async getInfo(
        checkin: FossilCheckin,
        field: 'parent' | 'hash'
    ): Promise<FossilHash> {
        return this.repository.getInfo(checkin, field);
    }

    @throttle
    public getBranches(opts: { closed?: true } = {}): Promise<BranchDetails[]> {
        return this.repository.getBranches(opts);
    }

    @throttle
    public async getCommitDetails(
        checkin: FossilCheckin
    ): Promise<CommitDetails> {
        const commits = await this.getLogEntries({
            checkin: checkin,
            limit: 1,
            verbose: true,
        });
        return commits[0]; // technically can be undefined. ignore.
    }

    public getLogEntries(
        options: LogEntriesOptions & { verbose: true }
    ): Promise<CommitDetails[]>;

    public getLogEntries(options?: LogEntriesOptions): Promise<Commit[]>;

    @throttle
    public getLogEntries(options: LogEntriesOptions = {}): Promise<Commit[]> {
        let filePath: RelativePath | undefined;
        if (options.fileUri) {
            filePath = this.mapFileUriToRepoRelativePath(options.fileUri);
        }

        const opts: TimelineOptions = {
            ...options,
            filePath: filePath,
            limit: options.limit || 512,
        } as const;
        return this.repository.getLogEntries(opts);
    }

    /**
     * `UpdateModelState` is called after every non read only operation run
     */
    @throttle
    public async updateModelState(
        reason = 'model state is updating'
    ): Promise<void> {
        const statusString = await this.repository.getStatus(reason);
        const currentBranchPromise = this.repository.getCurrentBranch();

        const fossilStatus = (this._fossilStatus =
            this.repository.parseStatusString(statusString));

        this._currentBranch = await currentBranchPromise;

        const groupInput: IGroupStatusesParams = {
            repositoryRoot: this.repository.root,
            fileStatuses: fossilStatus.statuses,
            statusGroups: this._groups,
        };

        groupStatuses(groupInput);
        this._sourceControl.count = this.count;
        this._onDidChangeStatus.fire();
        // this._onDidChangeRepository.fire()
    }

    private get count(): number {
        return (
            this.stagingGroup.resourceStates.length +
            this.workingGroup.resourceStates.length +
            this.conflictGroup.resourceStates.length +
            this.untrackedGroup.resourceStates.length
        );
    }

    dispose(): void {
        dispose(this.disposables);
    }
}
