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
    TextDocumentShowOptions,
} from 'vscode';
import {
    AnyPath,
    BranchDetails,
    Commit,
    CommitDetails,
    ConfigKey,
    Distinct,
    FossilBranch,
    FossilCheckin,
    FossilClass,
    FossilCommitMessage,
    FossilHash,
    FossilRemote,
    FossilRemoteName,
    FossilRoot,
    FossilStatus,
    FossilTag,
    FossilUndoCommand,
    MergeAction,
    OpenedRepository,
    Praise,
    RelativePath,
    ResourceStatus,
    StashID,
    StashItem,
    StatusString,
    TimelineOptions,
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
import typedConfig, { AutoSyncIntervalMs } from './config';

import * as path from 'path';
import {
    FossilResourceGroup,
    createEmptyStatusGroups,
    IStatusGroups,
    groupStatuses,
} from './resourceGroups';
import * as interaction from './interaction';
import type { InteractionAPI, NewBranchOptions } from './interaction';
import { FossilUriParams, toFossilUri } from './uri';

import { localize } from './main';
import type { ExecFailure, ExecResult, Reason } from './fossilExecutable';
const iconsRootPath = path.join(path.dirname(__dirname), 'resources', 'icons');

export type Changes = Distinct<string, 'changes from `fossil up --dry-run`'>;

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
        return this.renameResourceUri ?? this._resourceUri;
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

type SideEffects = {
    /**
     * Files could change
     * Only execute `fossil status`
     */
    status?: true;
    /**
     * Information about remote could change,
     * or local "head" has changed
     * Only execute `fossil update --dry-run', '--latest`
     */
    changes?: true;
    /**
     * Branch could be changed
     * Only execute `fossil branch current`
     */
    branch?: true;
    /**
     * Tooltip text to show in the statusBar. Currently unused.
     */
    syncText?: string;
};

const UpdateStatus: SideEffects = { status: true };
const UpdateStatusAndBranch: SideEffects = { status: true, branch: true };
const UpdateAll: SideEffects = { status: true, branch: true, changes: true };
const UpdateChanges: SideEffects = { changes: true };

export const enum CommitScope {
    /** try STAGING_GROUP, but if none, try WORKING_GROUP */
    UNKNOWN,
    /** don't use file from any group, useful for merge commit */
    ALL,
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

    /**
     * repository was:
     * - disposed
     * - files were (un)staged
     */
    private _onDidChangeResources = new EventEmitter<void>();
    private readonly onDidChangeResources: Event<void> =
        this._onDidChangeResources.event;

    private _onDidChangeOriginalResource = new EventEmitter<Uri>();
    readonly onDidChangeOriginalResource: Event<Uri> =
        this._onDidChangeOriginalResource.event;

    private _onRunOperation = new EventEmitter<void>();
    private readonly onRunOperation: Event<void> = this._onRunOperation.event;

    private _onDidRunOperation = new EventEmitter<void>();
    readonly onDidRunOperation: Event<void> = this._onDidRunOperation.event;

    private _sourceControl: SourceControl;
    private autoSyncTimer: ReturnType<typeof setTimeout> | undefined;

    private _currentBranch: FossilBranch | undefined;
    private _operations = new Map<symbol, SideEffects>();
    private _state = RepositoryState.Idle;
    private readonly disposables: Disposable[] = [];
    private readonly statusBar: StatusBarCommands;
    // ToDo: rename and possibly make non optional
    private _fossilStatus: FossilStatus | undefined;
    private _groups: IStatusGroups;

    get sourceControl(): Readonly<SourceControl> {
        return this._sourceControl;
    }

    @memoize
    private get onDidChangeOperations(): Event<void> {
        return anyEvent(
            this.onRunOperation as Event<any>,
            this.onDidRunOperation as Event<any>
        );
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

    get currentBranch(): FossilBranch | undefined {
        return this._currentBranch;
    }

    get fossilStatus(): FossilStatus | undefined {
        return this._fossilStatus;
    }

    get operations(): ReadonlyMap<symbol, SideEffects> {
        return this._operations;
    }

    toUri(rawPath: RelativePath): Uri {
        return Uri.file(path.join(this.repository.root, rawPath));
    }

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

    private operations_size: number = 0;

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
            arguments: [this satisfies Repository],
        };
        this._sourceControl.quickDiffProvider = this;

        const groups = createEmptyStatusGroups(this._sourceControl);

        this._groups = groups;
        this.disposables.push(
            ...Object.values(groups).map(
                (group: FossilResourceGroup) => group.disposable
            )
        );

        this.statusBar = new StatusBarCommands(this, this.sourceControl);
        this.onDidChangeOperations(
            this.statusBar.update,
            this.statusBar,
            this.disposables
        );
        this.updateModelState(UpdateAll, 'opening repository' as Reason).then(
            () => this.updateAutoSyncInterval(typedConfig.autoSyncIntervalMs)
        );
    }

    provideOriginalResource(uri: Uri): Uri | undefined {
        if (uri.scheme !== 'file') {
            return;
        }
        return toFossilUri(uri);
    }

    @throttle
    async refresh(): Promise<void> {
        await this.runWithProgress(UpdateAll, () => Promise.resolve());
    }

    private onFSChange(_uri: Uri): void {
        if (!typedConfig.autoRefresh) {
            return;
        }

        if (this.operations_size !== 0) {
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
        await this.updateModelState(UpdateStatus, 'idle update' as Reason);
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
            if (this.operations_size !== 0) {
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
        await this.runWithProgress(UpdateStatus, () =>
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
        await this.runWithProgress(UpdateStatus, () =>
            this.repository.forget(relativePaths)
        );
    }

    async rename(
        oldPath: AnyPath,
        newPath: RelativePath | UserPath
    ): Promise<void> {
        await this.runWithProgress(UpdateStatus, () =>
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
        await this.runWithProgress(UpdateStatus, () =>
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
        await this.runWithProgress(
            {} /* basic staging does't affect status */,
            async () => {
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
                    await this.runWithProgress(UpdateStatus, () =>
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
                    await this.runWithProgress(UpdateStatus, () =>
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
            }
        );
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
        }
        if (scope === CommitScope.WORKING_GROUP) {
            return this.workingGroup.resourceStates.map(r =>
                this.mapResourceToRepoRelativePath(r)
            );
        }
        return []; // scope === CommitScope.ALL
    }

    @throttle
    async commit(
        message: FossilCommitMessage,
        scope: Exclude<CommitScope, CommitScope.UNKNOWN>,
        newBranch: NewBranchOptions | undefined
    ): Promise<ExecResult> {
        return this.runWithProgress(UpdateStatusAndBranch, async () => {
            const user = typedConfig.username;
            const fileList = this.scopeToFileList(scope);
            return this.repository.commit(message, fileList, user, newBranch);
        });
    }

    @throttle
    async revert(...uris: Uri[]): Promise<void> {
        const resources = this.mapResources(uris);
        await this.runWithProgress(UpdateStatus, async () => {
            const toRevert: RelativePath[] = [];

            for (const r of resources) {
                if (r.status != ResourceStatus.EXTRA) {
                    toRevert.push(this.mapResourceToRepoRelativePath(r));
                }
            }
            await this.repository.revert(toRevert);
        });
    }

    @throttle
    async cleanAll(): Promise<void> {
        await this.runWithProgress(UpdateStatus, async () =>
            this.repository.cleanAll()
        );
    }

    @throttle
    async clean(paths: string[]): Promise<void> {
        await this.runWithProgress(UpdateStatus, async () =>
            this.repository.clean(paths)
        );
    }

    async newBranch(newBranch: NewBranchOptions): Promise<ExecResult> {
        // Creating a new branch doesn't change anything.
        return this.runWithProgress({}, () =>
            this.repository.newBranch(newBranch)
        );
    }

    async update(checkin?: FossilCheckin): Promise<void> {
        // Update command can change everything
        await this.runWithProgress(UpdateAll, () =>
            this.repository.update(checkin)
        );
    }

    async close(): Promise<boolean> {
        const msg = await this.runWithProgress(UpdateChanges, () =>
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
    ): Promise<T extends true ? FossilUndoCommand | 'NoUndo' : undefined>;

    @throttle
    async undoOrRedo(
        command: 'undo' | 'redo',
        dryRun: boolean
    ): Promise<FossilUndoCommand | undefined | 'NoUndo'> {
        const sideEffect = dryRun ? {} : UpdateAll;
        const undo = await this.runWithProgress(sideEffect, () =>
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

    @throttle
    async pull(name: FossilRemoteName): Promise<void> {
        return this.runWithProgress(UpdateChanges, async () => {
            await this.repository.pull(name);
        });
    }

    @throttle
    async push(name?: FossilRemoteName): Promise<void> {
        return this.runWithProgress(UpdateChanges, async () => {
            await this.repository.push(name);
        });
    }

    @throttle
    merge(
        checkin: FossilCheckin,
        mergeAction: MergeAction
    ): Promise<ExecResult> {
        return this.runWithProgress(UpdateStatus, async () => {
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

    // used for "praise" tooltips
    async info(checkin: FossilCheckin): Promise<{ [key: string]: string }> {
        return this.repository.info(checkin);
    }

    async config<T extends ConfigKey>(...keys: T[]): Promise<Map<T, string>> {
        return this.repository.config(keys);
    }

    async gitExport(): Promise<void> {
        return this.repository.gitExport();
    }

    async cat(params: FossilUriParams): Promise<Buffer | undefined> {
        await this.whenIdleAndFocused();

        return this.runWithProgress({}, async () => {
            const relativePath = path
                .relative(this.repository.root, params.path)
                .replace(/\\/g, '/') as RelativePath;
            return this.repository.cat(relativePath, params.checkin);
        });
    }

    async patchCreate(path: string): Promise<void> {
        return this.runWithProgress(UpdateStatus, async () =>
            this.repository.patchCreate(path)
        );
    }

    async patchApply(path: string): Promise<void> {
        return this.runWithProgress(UpdateStatus, async () =>
            this.repository.patchApply(path)
        );
    }

    async stash(
        message: FossilCommitMessage,
        scope: Exclude<CommitScope, CommitScope.UNKNOWN>,
        operation: 'save' | 'snapshot'
    ): Promise<void> {
        return this.runWithProgress(UpdateStatus, async () =>
            this.repository.stash(
                message,
                operation,
                this.scopeToFileList(scope)
            )
        );
    }

    async stashList(): Promise<StashItem[]> {
        return this.runWithProgress(UpdateStatus, async () =>
            this.repository.stashList()
        );
    }

    async stashPop(): Promise<void> {
        return this.runWithProgress(UpdateStatus, async () =>
            this.repository.stashPop()
        );
    }

    async stashApplyOrDrop(
        operation: 'apply' | 'drop',
        stashId: StashID
    ): Promise<void> {
        return this.runWithProgress(UpdateStatus, async () =>
            this.repository.stashApplyOrDrop(operation, stashId)
        );
    }

    private async runWithProgress<T>(
        sideEffects: SideEffects,
        runOperation: () => Promise<T> = () => Promise.resolve<any>(null)
    ): Promise<T> {
        if (this.state !== RepositoryState.Idle) {
            throw new Error('Repository not initialized');
        }

        return window.withProgress(
            { location: ProgressLocation.SourceControl },
            async () => {
                const key = Symbol();
                this._operations.set(key, sideEffects);
                this._onRunOperation.fire();

                try {
                    const operationResult = await runOperation();
                    await this.updateModelState(
                        sideEffects,
                        'Triggered by previous operation' as Reason
                    );
                    return operationResult;
                } finally {
                    this._operations.delete(key);
                    this._onDidRunOperation.fire();
                }
            }
        );
    }

    @throttle
    public async getRemotes(): Promise<FossilRemote[]> {
        return this.repository.getRemotes();
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
        filePath: RelativePath,
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
                title,
                { preview: false } as TextDocumentShowOptions
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
     *
     * what we do here:
     *   - execute `fossil status --differ --merge` to get status
     *   - execute `fossil branch current`to get current branch
     *   - parse status output to update SCM tree
     *   - get `changes`
     */
    @throttle
    public async updateModelState(
        sideEffects: SideEffects,
        reason: Reason = 'model state is updating' as Reason
    ): Promise<void> {
        const sidePromises: Promise<void>[] = [];
        if (sideEffects.status) {
            sidePromises.push(
                this.updateStatus(reason).then(err => {
                    if (err) {
                        if (err.fossilErrorCode === 'NotAFossilRepository') {
                            this.state = RepositoryState.Disposed;
                        } else {
                            throw new Error(
                                `Unexpected fossil result: ${String(err)}`
                            );
                        }
                    }
                })
            );
        }
        if (sideEffects.changes) {
            sidePromises.push(this.updateChanges(reason));
        }
        if (sideEffects.branch) {
            sidePromises.push(this.updateBranch());
        }
        await Promise.all(sidePromises);
    }

    public async updateStatus(
        reason?: Reason
    ): Promise<ExecFailure | undefined> {
        const result = await this.repository.getStatus(reason);
        if (result.exitCode) {
            return result;
        }

        const fossilStatus = (this._fossilStatus =
            this.repository.parseStatusString(result.stdout as StatusString));

        groupStatuses({
            repositoryRoot: this.repository.root,
            fileStatuses: fossilStatus.statuses,
            statusGroups: this._groups,
        });
        this._sourceControl.count = this.count;
        return;
    }

    private async updateBranch() {
        const currentBranch = await this.repository.getCurrentBranch();
        if (this._currentBranch !== currentBranch) {
            this._currentBranch = currentBranch;
        }
        this.updateInputBoxPlaceholder();
    }

    private get count(): number {
        return (
            this.stagingGroup.resourceStates.length +
            this.workingGroup.resourceStates.length +
            this.conflictGroup.resourceStates.length +
            this.untrackedGroup.resourceStates.length
        );
    }

    public updateAutoSyncInterval(interval: AutoSyncIntervalMs): void {
        clearTimeout(this.autoSyncTimer);
        const nextSyncTime = new Date(Date.now() + interval);
        this.statusBar.onSyncTimeUpdated(nextSyncTime);
        this.autoSyncTimer = setTimeout(() => this.sync(), interval);
    }

    /**
     * Reads `changes` from `fossil update --dry-run --latest`
     * and updates the status bar
     */
    private async updateChanges(reason: Reason): Promise<void> {
        const updateOutput = await this.repository.update(
            undefined,
            true,
            reason
        );
        if (updateOutput.exitCode) {
            this.statusBar.onChangesUpdated(
                'error' as Changes,
                updateOutput.stderr
            );
        } else {
            const match = updateOutput.stdout.match(/^changes:\s*(.*)/m);
            const changes = (match ? match[1] : 'unknown status') as Changes;
            this.statusBar.onChangesUpdated(changes);
        }
    }

    /**
     * runs `fossil sync`. when 'auto' is set to true, errors are ignored
     * and exec reason is set to 'periodic sync'.
     * after that the `changes` are updated and auto sync is rescheduled
     */
    async sync(auto?: true): Promise<void> {
        await this.repository.exec(
            ['sync'],
            auto ? ('periodic sync' as Reason) : undefined,
            { logErrors: !auto }
        );
        await this.updateChanges('sync happened' as Reason);
        this.updateAutoSyncInterval(typedConfig.autoSyncIntervalMs);
    }

    dispose(): void {
        dispose(this.disposables);
    }
}
