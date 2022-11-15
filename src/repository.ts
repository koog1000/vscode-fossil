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
} from 'vscode';
import {
    Repository as BaseRepository,
    Commit,
    FossilError,
    IRepoStatus,
    PullOptions,
    IMergeResult,
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
} from './fossilBase';
import {
    anyEvent,
    filterEvent,
    eventToPromise,
    dispose,
    IDisposable,
    delay,
    partition,
} from './util';
import { memoize, throttle, debounce } from './decorators';
import { StatusBarCommands } from './statusbar';
import typedConfig from './config';

import * as path from 'path';
import * as nls from 'vscode-nls';
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
import {
    interaction,
    InteractionAPI,
    PushCreatesNewHeadAction,
} from './interaction';
import { FossilUriParams, toFossilUri } from './uri';

const localize = nls.loadMessageBundle();
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
    fileUri?: Uri;
    limit?: TimelineOptions['limit'];
}

export const enum RepositoryState {
    Idle,
    Disposed,
}

export const enum Status {
    MODIFIED,
    ADDED,
    DELETED,
    UNTRACKED,
    IGNORED,
    MISSING,
    RENAMED,
    UNMODIFIED,
    CONFLICT,
}

type ThemeName = 'light' | 'dark';

export const enum MergeStatus {
    NONE,
    UNRESOLVED,
    RESOLVED,
}

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
        switch (this._status) {
            case Status.UNTRACKED:
            case Status.IGNORED:
                return false;

            case Status.ADDED:
            case Status.DELETED:
            case Status.MISSING:
            case Status.MODIFIED:
            case Status.RENAMED:
            case Status.CONFLICT:
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
                this._status === Status.MODIFIED ||
                this._status === Status.RENAMED ||
                this._status === Status.ADDED ||
                this._status === Status.CONFLICT
            ) {
                return this.renameResourceUri;
            }

            throw new Error(
                `Renamed resource with unexpected status: ${this._status}`
            );
        }
        return this._resourceUri;
    }
    get resourceGroup(): FossilResourceGroup {
        return this._resourceGroup;
    }
    get status(): Status {
        return this._status;
    }
    get mergeStatus(): MergeStatus {
        return this._mergeStatus;
    }

    private static Icons: { [key in ThemeName]: { [key in Status]: Uri } } = {
        light: {
            [Status.MODIFIED]: getIconUri('status-modified', 'light'),
            [Status.MISSING]: getIconUri('status-missing', 'light'),
            [Status.ADDED]: getIconUri('status-added', 'light'),
            [Status.DELETED]: getIconUri('status-deleted', 'light'),
            [Status.RENAMED]: getIconUri('status-renamed', 'light'),
            [Status.UNTRACKED]: getIconUri('status-untracked', 'light'),
            [Status.IGNORED]: getIconUri('status-ignored', 'light'),
            [Status.CONFLICT]: getIconUri('status-conflict', 'light'),
            [Status.UNMODIFIED]: getIconUri('status-clean', 'light'),
        },
        dark: {
            [Status.MODIFIED]: getIconUri('status-modified', 'dark'),
            [Status.MISSING]: getIconUri('status-missing', 'dark'),
            [Status.ADDED]: getIconUri('status-added', 'dark'),
            [Status.DELETED]: getIconUri('status-deleted', 'dark'),
            [Status.RENAMED]: getIconUri('status-renamed', 'dark'),
            [Status.UNTRACKED]: getIconUri('status-untracked', 'dark'),
            [Status.IGNORED]: getIconUri('status-ignored', 'dark'),
            [Status.CONFLICT]: getIconUri('status-conflict', 'dark'),
            [Status.UNMODIFIED]: getIconUri('status-clean', 'dark'),
        },
    };

    private getIconPath(theme: ThemeName): Uri {
        if (
            this.mergeStatus === MergeStatus.UNRESOLVED &&
            this.status !== Status.MISSING &&
            this.status !== Status.DELETED
        ) {
            return FossilResource.Icons[theme][Status.CONFLICT];
        }

        return FossilResource.Icons[theme][this.status];
    }

    private get strikeThrough(): boolean {
        switch (this.status) {
            case Status.DELETED:
                return true;
            default:
                return false;
        }
    }

    get decorations(): SourceControlResourceDecorations {
        const light = { iconPath: this.getIconPath('light') };
        const dark = { iconPath: this.getIconPath('dark') };

        return { strikeThrough: this.strikeThrough, light, dark };
    }

    constructor(
        private _resourceGroup: FossilResourceGroup,
        private _resourceUri: Uri,
        private _status: Status,
        private _mergeStatus: MergeStatus,
        private _renameResourceUri?: Uri
    ) {}
}

export const enum Operation {
    Status,
    Add,
    RevertFiles,
    Commit,
    Clean,
    Branch,
    Update,
    Undo,
    UndoDryRun,
    Pull,
    Push,
    Sync,
    Init,
    Show,
    Stage,
    Revert,
    Resolve,
    Unresolve,
    Parents,
    Remove,
    Merge,
    Close,
    Ignore,
    PatchCreate,
    PatchApply,
}

function isReadOnly(operation: Operation): boolean {
    switch (operation) {
        case Operation.Show:
            return true;
        default:
            return false;
    }
}

export const enum CommitScope {
    UNKNOWN, // try STAGING_GROUP, but if none, try WORKING_GROUP
    ALL, // don't use file from any group, useful for merge commit
    STAGING_GROUP,
    WORKING_GROUP,
}

export interface CommitOptions {
    scope: CommitScope;
    useBranch?: boolean;
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
    get mergeGroup(): FossilResourceGroup {
        return this._groups.merge;
    }
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

    private _repoStatus: IRepoStatus | undefined;
    get repoStatus(): IRepoStatus | undefined {
        return this._repoStatus;
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
            this.mergeGroup,
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
        this._groups.merge.updateResources([]);
        this._groups.staging.updateResources([]);
        this._groups.untracked.updateResources([]);
        this._groups.working.updateResources([]);
        this._onDidChangeResources.fire();
    }

    get root(): FossilRoot {
        return this.repository.root;
    }

    private readonly disposables: Disposable[] = [];
    public statusPromise: Promise<StatusString>;

    constructor(private readonly repository: BaseRepository) {
        const fsWatcher = workspace.createFileSystemWatcher('**');
        this.disposables.push(fsWatcher);

        const onWorkspaceChange = anyEvent(
            fsWatcher.onDidChange,
            fsWatcher.onDidCreate,
            fsWatcher.onDidDelete
        );
        const onRepositoryChange = filterEvent(
            onWorkspaceChange,
            uri => !/^\.\./.test(path.relative(repository.root, uri.fsPath))
        );
        const onRelevantRepositoryChange = filterEvent(
            onRepositoryChange,
            uri => !/\/\.hg\/(\w?lock.*|.*\.log([-.]\w+)?)$/.test(uri.path)
        );
        onRelevantRepositoryChange(this.onFSChange, this, this.disposables);

        const onRelevantHgChange = filterEvent(
            onRelevantRepositoryChange,
            uri => /\/\.hg\//.test(uri.path)
        );
        onRelevantHgChange(
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

        this.statusPromise = this.status();

        this.disposables.push(new AutoIncomingOutgoing(this));
    }

    provideOriginalResource(uri: Uri): Uri | undefined {
        if (uri.scheme !== 'file') {
            return;
        }
        return toFossilUri(uri);
    }

    @throttle
    async status(): Promise<StatusString> {
        const statusPromise = this.repository.getStatus();
        await this.runWithProgress(Operation.Status, () => statusPromise);
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
        await this.status();
        await delay(5000);
    }

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
        const relativePaths: string[] = resources.map(r =>
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
    async remove(...uris: Uri[]): Promise<void> {
        let resources: FossilResource[];
        if (uris.length === 0) {
            resources = this._groups.untracked.resourceStates;
        } else {
            resources = this.mapResources(uris);
        }
        const relativePaths: string[] = resources.map(r =>
            this.mapResourceToRepoRelativePath(r)
        );
        await this.runWithProgress(Operation.Remove, () =>
            this.repository.remove(relativePaths)
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
        const relativePaths: string[] = resources.map(r =>
            this.mapResourceToRepoRelativePath(r)
        );
        await this.runWithProgress(Operation.Ignore, () =>
            this.repository.ignore(relativePaths)
        );
    }

    mapResources(resourceUris: Uri[]): FossilResource[] {
        const resources: FossilResource[] = [];
        const { conflict, merge, working, untracked, staging } = this._groups;
        const groups = [working, staging, merge, untracked, conflict];
        for (const uri of resourceUris) {
            let found = false;
            for (const group of groups) {
                const resource = group.getResource(uri);
                if (resource && !found) {
                    resources.push(resource);
                    found = true;
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

            const missingResources = partition(
                resources,
                r => r.status === Status.MISSING
            );

            if (missingResources[0].length) {
                const relativePaths: string[] = missingResources[0].map(r =>
                    this.mapResourceToRepoRelativePath(r)
                );
                await this.runWithProgress(Operation.Remove, () =>
                    this.repository.remove(relativePaths)
                );
            }

            const untrackedResources = partition(
                resources,
                r => r.status === Status.UNTRACKED
            );

            if (untrackedResources[0].length) {
                const relativePaths: string[] = untrackedResources[0].map(r =>
                    this.mapResourceToRepoRelativePath(r)
                );
                await this.runWithProgress(Operation.Remove, () =>
                    this.repository.add(relativePaths)
                );
            }

            this._groups.staging.intersect(resources);
            this._groups.working.except(resources);
            this._onDidChangeResources.fire();
        });
    }

    // resource --> repo-relative path
    public mapResourceToRepoRelativePath(resource: FossilResource): string {
        const relativePath = this.mapFileUriToRepoRelativePath(
            resource.resourceUri
        );
        return relativePath;
    }

    // file uri --> repo-relative path
    private mapFileUriToRepoRelativePath(fileUri: Uri): string {
        const relativePath = path
            .relative(this.repository.root, fileUri.fsPath)
            .replace(/\\/g, '/');
        return relativePath;
    }

    // resource --> workspace-relative path
    public mapResourceToWorkspaceRelativePath(
        resource: FossilResource
    ): string {
        const relativePath = this.mapFileUriToWorkspaceRelativePath(
            resource.resourceUri
        );
        return relativePath;
    }

    // file uri --> workspace-relative path
    public mapFileUriToWorkspaceRelativePath(fileUri: Uri): string {
        const relativePath = path
            .relative(this.repository.root, fileUri.fsPath)
            .replace(/[/\\]/g, path.sep);
        return relativePath;
    }

    // repo-relative path --> workspace-relative path
    private mapRepositoryRelativePathToWorkspaceRelativePath(
        repoRelativeFilepath: string
    ): string {
        const fsPath = path.join(this.repository.root, repoRelativeFilepath);
        const relativePath = path
            .relative(this.repository.root, fsPath)
            .replace(/[/\\]/g, path.sep);
        return relativePath;
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

    scopeToFileList(
        scope: Exclude<CommitScope, CommitScope.UNKNOWN>
    ): string[] {
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
        branch: FossilBranch | undefined
    ): Promise<void> {
        await this.runWithProgress(Operation.Commit, async () => {
            const user = typedConfig.username;
            const fileList = this.scopeToFileList(scope);
            await this.repository.commit(message, { fileList, user, branch });
            return;
        });
    }

    @throttle
    async revert(...uris: Uri[]): Promise<void> {
        const resources = this.mapResources(uris);
        await this.runWithProgress(Operation.Revert, async () => {
            const toRevert: string[] = [];

            for (const r of resources) {
                switch (r.status) {
                    case Status.UNTRACKED:
                    case Status.IGNORED:
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
    async newBranch(name: FossilBranch): Promise<void> {
        await this.runWithProgress(Operation.Branch, () =>
            this.repository.newBranch(name)
        );
    }

    @throttle
    async update(
        treeish: FossilCheckin,
        opts?: { discard: boolean }
    ): Promise<void> {
        await this.runWithProgress(Operation.Update, () =>
            this.repository.update(treeish, opts)
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

    public isInAnyGroup(uri: Uri): boolean {
        return [
            this.workingGroup,
            this.stagingGroup,
            this.mergeGroup,
            this.conflictGroup,
        ].some(group => group.includesUri(uri));
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
        await this.runWithProgress(Operation.Pull, async () => {
            await this.repository.pull(options);
        });
    }

    @throttle
    async push(_path: FossilURI | undefined): Promise<void> {
        return await this.runWithProgress(Operation.Push, async () => {
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
    merge(
        revQuery: FossilCheckin,
        mergeAction: MergeAction
    ): Promise<IMergeResult> {
        return this.runWithProgress(Operation.Merge, async () => {
            try {
                return await this.repository.merge(revQuery, mergeAction);
            } catch (e) {
                if (
                    e instanceof FossilError &&
                    e.fossilErrorCode === 'UntrackedFilesDiffer' &&
                    e.untrackedFilenames
                ) {
                    e.untrackedFilenames = e.untrackedFilenames.map(filename =>
                        this.mapRepositoryRelativePathToWorkspaceRelativePath(
                            filename
                        )
                    );
                }
                throw e;
            }
        });
    }

    addTag(fossilBranch: FossilBranch, tag: FossilTag): Promise<void> {
        return this.repository.addTag(fossilBranch, tag);
    }

    cancelTag(fossilCheckin: FossilCheckin, tag: FossilTag): Promise<void> {
        return this.repository.cancelTag(fossilCheckin, tag);
    }

    async updateCommitMessage(
        fossilCheckin: FossilCheckin,
        commitMessage: FossilCommitMessage
    ): Promise<void> {
        return this.repository.updateCommitMessage(
            fossilCheckin,
            commitMessage
        );
    }

    async show(params: FossilUriParams): Promise<string> {
        // TODO@Joao: should we make this a general concept?
        await this.whenIdleAndFocused();

        return await this.runWithProgress(Operation.Show, async () => {
            const relativePath = path
                .relative(this.repository.root, params.path)
                .replace(/\\/g, '/');
            try {
                console.log(
                    'Repository: show: relativePath: ' +
                        relativePath +
                        ' checkin: ' +
                        params.checkin
                );
                return await this.repository.cat(relativePath, params.checkin!);
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
            return await commands.executeCommand<void>(
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
        let filePath: string | undefined = undefined;
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
    private async updateModelState(): Promise<void> {
        const statusString = await this.repository.getStatus();
        this._repoStatus = this.repository.getSummary(statusString);

        const currentRefPromise = this.repository.getCurrentBranch();

        const fileStat = this.repository
            .parseStatusLines(statusString)
            .concat(
                this.repository.parseExtrasLines(
                    await this.repository.getExtras()
                )
            );

        const currentRef = await currentRefPromise;

        this._currentBranch = currentRef;

        const groupInput: IGroupStatusesParams = {
            repositoryRoot: this.repository.root,
            fileStatuses: fileStat,
            // repoStatus: this._repoStatus,
            resolveStatuses: undefined,
            statusGroups: this._groups,
        };

        groupStatuses(groupInput);
        this._sourceControl.count = this.count;
        this._onDidChangeStatus.fire();
        // this._onDidChangeRepository.fire()
    }

    get count(): number {
        return (
            this.mergeGroup.resourceStates.length +
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
