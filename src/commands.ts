/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ben Crowl. All rights reserved.
 *  Original Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Uri,
    commands,
    Disposable,
    window,
    workspace,
    OutputChannel,
    SourceControlResourceState,
    SourceControlResourceGroup,
    TextDocumentShowOptions,
    ViewColumn,
    Selection,
    ExtensionContext,
} from 'vscode';
import { LineChange, revertChanges } from './revert';
import * as nls from 'vscode-nls';
import * as path from 'path';
import {
    Fossil,
    FossilError,
    FossilPath,
    FossilRoot,
    FossilURI,
    FossilCheckin,
    MergeAction,
    FossilHash,
    FossilSpecialTags,
    FossilBranch,
    FossilCommitMessage,
    FossilPassword,
    FossilUsername,
} from './fossilBase';
import { Model } from './model';
import {
    FossilResource,
    Status,
    CommitOptions,
    CommitScope,
    MergeStatus,
    Repository,
} from './repository';
import { FossilResourceGroup, isResourceGroup } from './resourceGroups';
import {
    interaction,
    BranchExistsAction,
    WarnScenario,
    CommitSources,
} from './interaction';
import { humanise } from './humanise';
import { partition } from './util';
import { toFossilUri } from './uri';
import { FossilPreviewManager } from './preview';

const localize = nls.loadMessageBundle();

type CommandKey =
    | 'add'
    | 'addAll'
    | 'branch'
    | 'branchChange'
    | 'cherrypick'
    | 'clean'
    | 'clone'
    | 'close'
    | 'closeBranch'
    | 'commit'
    | 'commitAll'
    | 'commitBranch'
    | 'commitStaged'
    | 'commitWithInput'
    | 'deleteFile'
    | 'deleteFiles'
    | 'fileLog'
    | 'ignore'
    | 'init'
    | 'integrate'
    | 'log'
    | 'merge'
    | 'open'
    | 'openChange'
    | 'openChangeFromUri'
    | 'openFile'
    | 'openFileFromUri'
    | 'openFiles'
    | 'openResource'
    | 'openUI'
    | 'patchApply'
    | 'patchCreate'
    | 'pull'
    | 'push'
    | 'pushTo'
    | 'redo'
    | 'refresh'
    | 'remove'
    | 'render'
    | 'reopenBranch'
    | 'revert'
    | 'revertAll'
    | 'revertChange'
    | 'showOutput'
    | 'stage'
    | 'stageAll'
    | 'stashApply'
    | 'stashDrop'
    | 'stashPop'
    | 'stashSave'
    | 'stashSnapshot'
    | 'undo'
    | 'unstage'
    | 'unstageAll'
    | 'update'
    | 'wikiCreate';
type CommandId = `fossil.${CommandKey}`;

interface Command {
    id: CommandId;
    method: CommandMethod;
}
type CommandMethod = (() => any) | ((...args: any) => Promise<void>);

function makeCommandWithRepository(method: CommandMethod): CommandMethod {
    return async function (this: CommandCenter, ...args: any[]): Promise<void> {
        const repository = await this.guessRepository(args[0]);
        if (repository) {
            return Promise.resolve(method.apply(this, [repository, ...args]));
        }
    };
}

/**
 * Decorator
 */
function command(id: CommandId, options: { repository?: boolean } = {}) {
    return (
        target: CommandCenter,
        key: unknown,
        descriptor: TypedPropertyDescriptor<CommandMethod>
    ): TypedPropertyDescriptor<CommandMethod> => {
        if (!descriptor.value) {
            throw new Error('descriptor with no value');
        }
        if (options.repository) {
            descriptor.value = makeCommandWithRepository(descriptor.value);
        }
        target.register.push({ id, method: descriptor.value });
        return descriptor;
    };
}

function setProtoArray<K extends string>(target: Record<K, Command[]>, key: K) {
    target[key] = [];
}

export class CommandCenter {
    @setProtoArray
    register!: Command[];

    private disposables: Disposable[];
    private previewManager: FossilPreviewManager;

    constructor(
        private readonly fossil: Fossil,
        private readonly model: Model,
        private readonly outputChannel: OutputChannel,
        private readonly context: ExtensionContext
    ) {
        this.previewManager = new FossilPreviewManager(context, fossil);

        this.disposables = this.register.map(command => {
            return commands.registerCommand(command.id, command.method, this);
        });
    }

    @command('fossil.refresh', { repository: true })
    async refresh(repository: Repository): Promise<void> {
        await repository.status();
    }

    @command('fossil.openResource')
    async openResource(resource: FossilResource): Promise<void> {
        await this._openResource(resource, undefined, true, false);
    }

    private async _openResource(
        resource: FossilResource | undefined,
        preview?: boolean,
        preserveFocus?: boolean,
        preserveSelection?: boolean
    ): Promise<void> {
        if (!resource) return;
        const left = this.getLeftResource(resource);
        const right = this.getRightResource(resource);
        const title = this.getTitle(resource);

        const opts: TextDocumentShowOptions = {
            preserveFocus,
            preview,
            viewColumn: ViewColumn.Active,
        };

        const activeTextEditor = window.activeTextEditor;

        // Check if active text editor has same path as other editor. we cannot compare via
        // URI.toString() here because the schemas can be different. Instead we just go by path.
        if (
            preserveSelection &&
            activeTextEditor &&
            activeTextEditor.document.uri.path === right.path
        ) {
            opts.selection = activeTextEditor.selection;
        }

        if (!left) {
            const document = await workspace.openTextDocument(right);
            await window.showTextDocument(document, opts);
            return;
        }
        return commands.executeCommand<void>(
            'vscode.diff',
            left,
            right,
            title,
            opts
        );
    }

    private getLeftResource(resource: FossilResource): Uri | undefined {
        switch (resource.status) {
            case Status.RENAMED:
                if (resource.renameResourceUri) {
                    return toFossilUri(resource.original);
                }
                return undefined;

            case Status.ADDED:
            case Status.IGNORED:
            case Status.UNTRACKED:
            case Status.UNMODIFIED:
                return undefined;

            case Status.MODIFIED:
            case Status.CONFLICT:
            case Status.DELETED:
            case Status.MISSING:
            default:
                return toFossilUri(resource.original);
        }
    }

    private getRightResource(resource: FossilResource): Uri {
        if (
            resource.mergeStatus === MergeStatus.UNRESOLVED &&
            resource.status !== Status.MISSING &&
            resource.status !== Status.DELETED
        ) {
            return resource.resourceUri.with({ scheme: 'fossil' });
        }

        switch (resource.status) {
            case Status.DELETED:
            case Status.MISSING:
                return resource.resourceUri.with({
                    scheme: 'fossil',
                    query: 'empty',
                });

            case Status.ADDED:
            case Status.IGNORED:
            case Status.MODIFIED:
            case Status.RENAMED:
            case Status.UNTRACKED:
            case Status.UNMODIFIED:
            case Status.CONFLICT:
            default:
                return resource.resourceUri;
        }
    }

    private getTitle(resource: FossilResource): string {
        const basename = path.basename(resource.resourceUri.fsPath);
        if (
            resource.mergeStatus === MergeStatus.UNRESOLVED &&
            resource.status !== Status.MISSING &&
            resource.status !== Status.DELETED
        ) {
            return `${basename} (local <-> other)`;
        }

        switch (resource.status) {
            case Status.MODIFIED:
            case Status.ADDED:
            case Status.CONFLICT:
                return `${basename} (Working Directory)`;

            case Status.RENAMED:
                return `${basename} (Renamed)`;

            case Status.DELETED:
                return `${basename} (Deleted)`;

            case Status.MISSING:
                return `${basename} (Missing)`;
        }

        return '';
    }

    @command('fossil.clone')
    async clone(): Promise<void> {
        let url = await interaction.inputRepoUrl();
        if (!url) {
            return;
        }
        let password: FossilPassword | undefined;
        let username: FossilUsername | undefined;

        // uri.authority = [userinfo "@"] host [":" port]
        let host = url.authority;
        // match:
        // - username:pws@host
        // - username@host
        const found = url.authority.match(
            /((?<username>.+?):(?<password>.+)|(?<full>.+))@/
        );
        if (found) {
            // we have username and optionally password
            password = found.groups!.password as FossilPassword | undefined;
            username = (
                password === undefined
                    ? found.groups!.full
                    : found.groups!.username
            ) as FossilUsername;
            host = host.slice(found[0].length);
        }

        if (url.scheme.toLowerCase() != 'file') {
            if (username === undefined) {
                username = await interaction.inputCloneUser();
                if (username === undefined) {
                    return; // user pressed <Esc>
                }
            }
            if (username) {
                if (password === undefined) {
                    password = await interaction.inputClonePassword();
                    // if user pressed <Esc> its okay - he or she just
                    // don't want to specify a password
                }
                const userinfo = password
                    ? username + ':' + password
                    : username;
                const authority = userinfo.replace('@', '%40') + '@' + host;
                url = url.with({ authority: authority }) as FossilURI;
            }
        }
        const fossilPath = await interaction.selectNewFossilPath('Clone');
        if (!fossilPath) {
            return;
        }

        const clonePromise = this.fossil.clone(url, fossilPath);
        interaction.statusCloning(clonePromise);
        const fossilRoot = await clonePromise;
        await this.askOpenRepository(fossilPath, fossilRoot);
    }

    /**
     * Execute "fossil open". When FossilRoot has files allow to
     * run "fossil open --force"
     */
    async openRepository(
        filePath: FossilPath,
        parentPath: FossilRoot
    ): Promise<void> {
        try {
            await this.fossil.openClone(filePath, parentPath);
        } catch (err) {
            if (
                err instanceof FossilError &&
                err.fossilErrorCode === 'OperationMustBeForced'
            ) {
                const openNotEmpty = await interaction.confirmOpenNotEmpty(
                    parentPath
                );
                if (openNotEmpty) {
                    this.fossil.openCloneForce(filePath, parentPath);
                }
            } else {
                throw err;
            }
        }
    }

    /**
     * ask user to run "fossil open" after `clone` or `init`
     */
    async askOpenRepository(
        filePath: FossilPath,
        fossilRoot: FossilRoot
    ): Promise<void> {
        const openClonedRepo = await interaction.promptOpenClonedRepo();
        if (openClonedRepo) {
            await this.openRepository(filePath, fossilRoot);
            await this.model.tryOpenRepository(fossilRoot);
        }
    }

    @command('fossil.init')
    async init(): Promise<void> {
        const fossilPath = await interaction.selectNewFossilPath('Create');

        if (!fossilPath) {
            return;
        }
        const fossilRoot = path.dirname(fossilPath) as FossilRoot;
        let projectName = '';
        let projectDesc = '';
        if (this.fossil.version >= [2, 18]) {
            const userProjectName = await interaction.inputProjectName();
            if (userProjectName === undefined) {
                return;
            }
            projectName = userProjectName;

            const userProjectDesc = await interaction.inputProjectDescription();
            if (userProjectDesc === undefined) {
                return;
            }
            projectDesc = userProjectDesc;
        }

        // run init in the file folder in case any artifacts appear
        await this.fossil.init(
            fossilRoot,
            fossilPath,
            projectName,
            projectDesc
        );
        await this.askOpenRepository(fossilPath, fossilRoot);
    }

    @command('fossil.open')
    async open(): Promise<void> {
        const fossilPath = await interaction.selectExistingFossilPath();
        if (!fossilPath) {
            return;
        }
        const rootPath = await interaction.selectFossilRootPath();
        if (!rootPath) {
            return;
        }
        await this.openRepository(fossilPath, rootPath);
        await this.model.tryOpenRepository(rootPath);
    }

    @command('fossil.close', { repository: true })
    async close(repository: Repository): Promise<void> {
        return this.model.close(repository);
    }

    @command('fossil.openFiles')
    openFiles(
        ...resources: (FossilResource | SourceControlResourceGroup)[]
    ): Promise<void> {
        if (resources.length === 1) {
            // a resource group proxy object?
            const [resourceGroup] = resources;
            if (isResourceGroup(resourceGroup)) {
                // const groupId = resourceGroup.id
                const resources =
                    resourceGroup.resourceStates as FossilResource[];
                return this.openFile(...resources);
            }
        }

        return this.openFile(...(<FossilResource[]>resources));
    }

    @command('fossil.openFile')
    async openFile(...resources: FossilResource[]): Promise<void> {
        if (!resources) {
            return;
        }

        const uris = resources.map(res => res.resourceUri);
        const preview = uris.length === 1;
        const activeTextEditor = window.activeTextEditor;

        for (const uri of uris) {
            const opts: TextDocumentShowOptions = {
                preserveFocus: true,
                preview,
                viewColumn: ViewColumn.Active,
            };

            // Check if active text editor has same path as other editor. we cannot compare via
            // URI.toString() here because the schemas can be different. Instead we just go by path.
            if (
                activeTextEditor &&
                activeTextEditor.document.uri.path === uri.path
            ) {
                opts.selection = activeTextEditor.selection;
            }

            const document = await workspace.openTextDocument(uri);
            await window.showTextDocument(document, opts);
        }
    }

    @command('fossil.openChange')
    async openChange(...resources: FossilResource[]): Promise<void> {
        if (!resources) {
            return;
        }

        if (resources.length === 1) {
            // a resource group proxy object?
            const [resourceGroup] = resources;
            if (isResourceGroup(resourceGroup)) {
                // const groupId = resourceGroup.id;
                const resources =
                    resourceGroup.resourceStates as FossilResource[];
                return this.openChange(...resources);
            }
        }

        const preview = resources.length === 1 ? undefined : false;
        for (const resource of resources) {
            await this._openResource(resource, preview, true, false);
        }
    }

    @command('fossil.openFileFromUri')
    async openFileFromUri(uri?: Uri): Promise<void> {
        const resource = this.getSCMResource(uri);

        if (!resource) {
            return;
        }

        return this.openFile(resource);
    }

    @command('fossil.openChangeFromUri')
    async openChangeFromUri(uri?: Uri): Promise<void> {
        const resource = this.getSCMResource(uri);

        if (!resource) {
            return;
        }

        return this._openResource(resource);
    }

    @command('fossil.ignore')
    async ignore(
        ...resourceStates: SourceControlResourceState[]
    ): Promise<void> {
        if (resourceStates.length === 0) {
            const resource = this.getSCMResource();

            if (!resource) {
                return;
            }

            resourceStates = [resource];
        }

        const scmResources = resourceStates.filter(
            s => s instanceof FossilResource && s.resourceGroup.is('untracked')
        );

        if (!scmResources.length) {
            return;
        }

        const resources = scmResources.map(r => r.resourceUri);
        const repository = this.model.getRepository(resources[0]);
        if (repository) {
            await repository.ignore(...resources);
        }
        // await this.runByRepository(resources, async (repository, uris) => repository.ignore(...uris));
    }

    @command('fossil.addAll', { repository: true })
    async addAll(repository: Repository): Promise<void> {
        await repository.add();
        return repository.stage();
    }

    @command('fossil.add')
    async add(...resourceStates: SourceControlResourceState[]): Promise<void> {
        if (resourceStates.length === 0) {
            const resource = this.getSCMResource();

            if (!resource) {
                return;
            }

            resourceStates = [resource];
        }

        const scmResources = resourceStates.filter(
            s => s instanceof FossilResource && s.resourceGroup.is('untracked')
        );

        if (!scmResources.length) {
            return;
        }

        const resources = scmResources.map(r => r.resourceUri);
        const repository = this.model.getRepository(resources[0]);
        if (repository) {
            await repository.add(...resources);
            await repository.stage(...resources);
        }
    }

    @command('fossil.remove')
    async remove(
        ...resourceStates: SourceControlResourceState[]
    ): Promise<void> {
        if (resourceStates.length === 0) {
            const resource = this.getSCMResource();

            if (!resource) {
                return;
            }

            resourceStates = [resource];
        }

        const scmResources = resourceStates.filter(
            s => s instanceof FossilResource && s.resourceGroup.is('working')
        );

        if (!scmResources.length) {
            return;
        }

        const resources = scmResources.map(r => r.resourceUri);
        const repository = this.model.getRepository(resources[0]);
        if (repository) {
            await repository.remove(...resources);
        }
        // await this.runByRepository(resources, async (repository, uris) => repository.remove(...uris));
    }

    private async deleteResources(
        repository: Repository,
        resources: SourceControlResourceState[]
    ): Promise<void> {
        const paths = resources
            .filter(resource => resource.resourceUri.scheme === 'file')
            .map(resource => resource.resourceUri.fsPath);
        if (await interaction.confirmDeleteResources(paths)) {
            await repository.clean(paths);
        }
    }

    @command('fossil.deleteFile', { repository: true })
    async deleteFile(
        repository: Repository,
        ...resourceStates: SourceControlResourceState[]
    ): Promise<void> {
        return this.deleteResources(repository, resourceStates);
    }

    @command('fossil.deleteFiles', { repository: true })
    async deleteFiles(
        repository: Repository,
        ...resourceGroups: FossilResourceGroup[]
    ): Promise<void> {
        return this.deleteResources(
            repository,
            resourceGroups.map(group => group.resourceStates).flat()
        );
    }

    @command('fossil.stage') // run by repo
    async stage(
        ...resourceStates: SourceControlResourceState[]
    ): Promise<void> {
        if (resourceStates.length === 0) {
            const resource = this.getSCMResource();

            if (!resource) {
                return;
            }

            resourceStates = [resource];
        }

        const scmResources = resourceStates.filter(
            s =>
                s instanceof FossilResource &&
                (s.resourceGroup.is('working') ||
                    s.resourceGroup.is('merge') ||
                    s.resourceGroup.is('untracked'))
        );

        if (!scmResources.length) {
            return;
        }

        const resources = scmResources.map(r => r.resourceUri);
        const repository = this.model.getRepository(resources[0]);
        if (repository) {
            await repository.stage(...resources);
        }
    }

    @command('fossil.stageAll', { repository: true })
    async stageAll(repository: Repository): Promise<void> {
        await repository.stage();
    }

    @command('fossil.unstage')
    async unstage(
        ...resourceStates: SourceControlResourceState[]
    ): Promise<void> {
        if (resourceStates.length === 0) {
            const resource = this.getSCMResource();

            if (!resource) {
                return;
            }

            resourceStates = [resource];
        }

        const scmResources = resourceStates.filter(
            s => s instanceof FossilResource && s.resourceGroup.is('staging')
        );

        if (!scmResources.length) {
            return;
        }

        const resources = scmResources.map(r => r.resourceUri);
        const repository = this.model.getRepository(resources[0]);
        if (repository) {
            await repository.unstage(...resources);
        }
        // await this.runByRepository(resources, async (repository, uris) => repository.unstage(...uris));
    }

    @command('fossil.unstageAll', { repository: true })
    async unstageAll(repository: Repository): Promise<void> {
        return repository.unstage();
    }

    @command('fossil.revert')
    async revert(
        ...resourceStates: SourceControlResourceState[]
    ): Promise<void> {
        if (resourceStates.length === 0) {
            const resource = this.getSCMResource();

            if (!resource) {
                return;
            }

            resourceStates = [resource];
        }

        const scmResources = resourceStates.filter(
            (s): s is FossilResource =>
                s instanceof FossilResource && s.isDirtyStatus
        );

        if (!scmResources.length) {
            return;
        }

        const [discardResources, addedResources] = partition(
            scmResources,
            s => s.status !== Status.ADDED
        );
        if (discardResources.length > 0) {
            const confirmFilenames = discardResources.map(r =>
                path.basename(r.resourceUri.fsPath)
            );
            const addedFilenames = addedResources.map(r =>
                path.basename(r.resourceUri.fsPath)
            );

            const confirmed = await interaction.confirmDiscardChanges(
                confirmFilenames,
                addedFilenames
            );
            if (!confirmed) {
                return;
            }
        }

        const resources = scmResources.map(r => r.resourceUri);
        const repository = this.model.getRepository(resources[0]);
        if (repository) {
            await repository.revert(...resources);
        }
        // await this.runByRepository(resources, async (repository, uris) => repository.revert(...uris));
    }

    @command('fossil.revertAll', { repository: true })
    async revertAll(repository: Repository): Promise<void> {
        if (await interaction.confirmDiscardAllChanges()) {
            const resources = repository.workingGroup.resourceStates;
            await repository.revert(...resources.map(r => r.resourceUri));
        }
    }

    @command('fossil.clean', { repository: true })
    async clean(repository: Repository): Promise<void> {
        if (await interaction.confirmDeleteExtras()) {
            await repository.cleanAll();
        }
    }

    private async checkTrackedUnsavedFiles(
        repository: Repository
    ): Promise<boolean> {
        const allUnsavedDocuments = workspace.textDocuments.filter(
            doc => !doc.isUntitled && doc.isDirty
        );
        const existingUris = new Set<string>();
        if (allUnsavedDocuments.length) {
            (
                await repository.ls(...allUnsavedDocuments.map(doc => doc.uri))
            ).map(uri => existingUris.add(uri.fsPath));
        }
        const documents = allUnsavedDocuments.filter(
            doc =>
                existingUris.has(doc.uri.fsPath) ||
                repository.isInAnyGroup(doc.uri)
        );
        if (documents.length > 0) {
            const message =
                documents.length === 1
                    ? localize(
                          'unsaved files single',
                          "The following file has unsaved changes which won't be included in the commit if you proceed: {0}.\n\nWould you like to save it before committing?",
                          path.basename(documents[0].uri.fsPath)
                      )
                    : localize(
                          'unsaved files',
                          'There are {0} unsaved files.\n\nWould you like to save them before committing?',
                          documents.length
                      );
            const saveAndCommit = localize(
                'save and commit',
                'Save All & Commit'
            );
            const commit = localize('commit', 'C&&ommit Staged Changes');
            const pick = await window.showWarningMessage(
                message,
                { modal: true },
                saveAndCommit,
                commit
            );

            if (pick === saveAndCommit) {
                await Promise.all(documents.map(d => d.save()));
                await repository.add(...documents.map(d => d.uri));
            } else if (pick !== commit) {
                return false; // do not commit on cancel
            }
        }
        return true;
    }
    private async confirmCommitScope(
        repository: Repository,
        scope: CommitScope
    ): Promise<Exclude<CommitScope, CommitScope.UNKNOWN> | undefined> {
        const numWorkingResources =
            repository.workingGroup.resourceStates.length;
        const numStagingResources =
            repository.stagingGroup.resourceStates.length;
        if (scope === CommitScope.UNKNOWN) {
            if (numWorkingResources > 0 && numStagingResources == 0) {
                const useWorkingGroup =
                    await interaction.confirmCommitWorkingGroup();
                if (!useWorkingGroup) {
                    return;
                }
                scope = CommitScope.WORKING_GROUP;
            } else {
                scope = CommitScope.STAGING_GROUP;
            }
        }

        if (scope === CommitScope.WORKING_GROUP) {
            const missingResources =
                repository.workingGroup.resourceStates.filter(
                    r => r.status === Status.MISSING
                );
            if (missingResources.length > 0) {
                const missingFilenames = missingResources.map(r =>
                    repository.mapResourceToWorkspaceRelativePath(r)
                );
                const deleteConfirmed =
                    await interaction.confirmDeleteMissingFilesForCommit(
                        missingFilenames
                    );
                if (!deleteConfirmed) {
                    return;
                }
                await this.remove(...missingResources);
            }
        }

        if (
            (numWorkingResources === 0 && numStagingResources === 0) || // no changes
            (scope === CommitScope.STAGING_GROUP &&
                numStagingResources === 0) || // no staged changes
            (scope === CommitScope.WORKING_GROUP && numWorkingResources === 0) // no working directory changes
        ) {
            interaction.informNoChangesToCommit();
            return;
        }
        return scope;
    }
    private async validateNoConflicts(
        repository: Repository,
        scope: CommitScope
    ): Promise<Exclude<CommitScope, CommitScope.UNKNOWN> | undefined> {
        const numConflictResources =
            repository.conflictGroup.resourceStates.length;
        if (numConflictResources > 0) {
            await interaction.warnResolveConflicts();
            return;
        }
        const isMergeCommit = repository.repoStatus?.isMerge;

        if (isMergeCommit) {
            return CommitScope.ALL;
        } else {
            return this.confirmCommitScope(repository, scope);
        }
    }

    private async smartCommit(
        repository: Repository,
        getCommitMessage: () => Promise<FossilCommitMessage | undefined>,
        opts: CommitOptions = { scope: CommitScope.UNKNOWN }
    ): Promise<boolean> {
        if (!(await this.checkTrackedUnsavedFiles(repository))) {
            return false;
        }
        const scope = await this.validateNoConflicts(repository, opts.scope);
        if (scope === undefined) {
            return false;
        }
        const branch: FossilBranch | undefined =
            (opts.useBranch || undefined) &&
            (await interaction.inputNewBranchName());

        const message = await getCommitMessage();

        if (message === undefined) {
            return false;
        }

        await repository.commit(message, scope, branch);

        return true;
    }

    private async commitWithAnyInput(
        repository: Repository,
        opts: CommitOptions
    ): Promise<void> {
        const inputBox = repository.sourceControl.inputBox;
        const message = inputBox.value as FossilCommitMessage;
        const didCommit = await this.smartCommit(
            repository,
            () =>
                message
                    ? Promise.resolve(message)
                    : interaction.inputCommitMessage(),
            opts
        );

        if (message && didCommit) {
            inputBox.value = '';
        }
    }

    @command('fossil.commit', { repository: true })
    async commit(repository: Repository): Promise<void> {
        await this.commitWithAnyInput(repository, {
            scope: CommitScope.UNKNOWN,
        });
    }

    @command('fossil.commitWithInput', { repository: true })
    async commitWithInput(repository: Repository): Promise<void> {
        const didCommit = await this.smartCommit(
            repository,
            async () =>
                repository.sourceControl.inputBox.value as FossilCommitMessage
        );

        if (didCommit) {
            repository.sourceControl.inputBox.value = '';
        }
    }

    @command('fossil.commitStaged', { repository: true })
    async commitStaged(repository: Repository): Promise<void> {
        await this.commitWithAnyInput(repository, {
            scope: CommitScope.STAGING_GROUP,
        });
    }

    @command('fossil.commitAll', { repository: true })
    async commitAll(repository: Repository): Promise<void> {
        await this.commitWithAnyInput(repository, { scope: CommitScope.ALL });
    }

    @command('fossil.commitBranch', { repository: true })
    async commitBranch(repository: Repository): Promise<void> {
        await this.commitWithAnyInput(repository, {
            scope: CommitScope.UNKNOWN,
            useBranch: true,
        });
    }

    private focusScm() {
        commands.executeCommand('workbench.view.scm');
    }

    private async undoOrRedo(repository: Repository, command: 'undo' | 'redo') {
        try {
            const undo = await repository.undoOrRedo(command, true); // dry-run
            if (await interaction.confirmUndoOrRedo(command, undo)) {
                await repository.undoOrRedo(command, false); // real-thing
            }
        } catch (e) {
            if (
                e instanceof FossilError &&
                e.fossilErrorCode === 'NoUndoInformationAvailable'
            ) {
                await interaction.warnNoUndoOrRedo(command);
            }
        }
    }

    @command('fossil.undo', { repository: true })
    async undo(repository: Repository): Promise<void> {
        return this.undoOrRedo(repository, 'undo');
    }

    @command('fossil.redo', { repository: true })
    async redo(repository: Repository): Promise<void> {
        return this.undoOrRedo(repository, 'redo');
    }

    @command('fossil.patchCreate', { repository: true })
    async patchCreate(repository: Repository): Promise<void> {
        const newPatchPath = await interaction.inputPatchCreate();
        if (newPatchPath) {
            await repository.patchCreate(newPatchPath);
        }
    }

    @command('fossil.patchApply', { repository: true })
    async patchApply(repository: Repository): Promise<void> {
        const newPatchPath = await interaction.inputPatchApply();
        if (newPatchPath) {
            await repository.patchApply(newPatchPath);
        }
    }

    private async stash(
        repository: Repository,
        operation: 'save' | 'snapshot'
    ): Promise<void> {
        const now = new Date();
        const dateTime = new Date(
            now.getTime() - now.getTimezoneOffset() * 60000
        )
            .toISOString()
            .slice(0, 19)
            .replace('T', ' ');
        const defaultMessage =
            `vscode-${operation} ${dateTime}` as FossilCommitMessage;
        const stashCommitMessage = await interaction.inputCommitMessage(
            defaultMessage
        );
        if (stashCommitMessage !== undefined) {
            if (!(await this.checkTrackedUnsavedFiles(repository))) {
                return;
            }
            const scope = await this.validateNoConflicts(
                repository,
                CommitScope.UNKNOWN
            );
            if (scope === undefined) {
                return;
            }
            await repository.stash(stashCommitMessage, scope, operation);
        }
    }

    @command('fossil.stashSnapshot', { repository: true })
    async stashSnapshot(repository: Repository): Promise<void> {
        return this.stash(repository, 'snapshot');
    }

    @command('fossil.stashSave', { repository: true })
    async stashSave(repository: Repository): Promise<void> {
        return this.stash(repository, 'save');
    }

    private async stashApplyOrDrop(
        repository: Repository,
        operation: 'apply' | 'drop'
    ) {
        const items = await repository.stashList();
        const stashId = await interaction.pickStashItem(items, operation);
        if (stashId) {
            repository.stashApplyOrDrop(operation, stashId);
        }
    }

    @command('fossil.stashPop', { repository: true })
    async stashPop(repository: Repository): Promise<void> {
        return repository.stashPop();
    }

    @command('fossil.stashApply', { repository: true })
    async stashApply(repository: Repository): Promise<void> {
        return this.stashApplyOrDrop(repository, 'apply');
    }

    @command('fossil.stashDrop', { repository: true })
    async stashDrop(repository: Repository): Promise<void> {
        return this.stashApplyOrDrop(repository, 'drop');
    }

    @command('fossil.update', { repository: true })
    async update(repository: Repository): Promise<void> {
        const unclean = false;

        // branches/tags
        if (
            (await interaction.checkThenWarnOutstandingMerge(repository)) ||
            (await interaction.checkThenErrorUnclean(
                repository,
                WarnScenario.Update
            ))
        ) {
            this.focusScm();
            return;
        }
        const refs = await repository.getBranchesAndTags();

        const choice = await interaction.pickUpdateRevision(refs, unclean);

        if (choice) {
            await choice.run(repository);
        }
    }

    @command('fossil.branchChange', { repository: true })
    async branchChange(repository: Repository): Promise<void> {
        const unclean = false;

        // branches/tags
        if (await interaction.checkThenWarnOutstandingMerge(repository)) {
            this.focusScm();
            return;
        }
        await interaction.checkThenWarnUnclean(repository, WarnScenario.Update);
        const refs = await repository.getBranchesAndTags();

        const choice = await interaction.pickUpdateRevision(refs, unclean);

        if (choice) {
            await choice.run(repository);
        }
    }

    @command('fossil.branch', { repository: true })
    async branch(repository: Repository): Promise<void> {
        const fossilBranch = await interaction.inputNewBranchName();
        if (!fossilBranch) {
            return;
        }
        try {
            await repository.newBranch(fossilBranch);
        } catch (e) {
            if (
                e instanceof FossilError &&
                e.fossilErrorCode === 'BranchAlreadyExists'
            ) {
                const action = await interaction.warnBranchAlreadyExists(
                    fossilBranch
                );
                if (action === BranchExistsAction.Reopen) {
                    await repository.newBranch(fossilBranch);
                } else if (action === BranchExistsAction.UpdateTo) {
                    await repository.update(fossilBranch);
                }
            }
        }
    }

    @command('fossil.pull', { repository: true })
    async pull(repository: Repository): Promise<void> {
        const paths = await repository.getPath();

        if (!paths.url) {
            return interaction.warnNoPaths('pull');
        }

        const pullOptions = await repository.createPullOptions();
        await repository.pull(pullOptions);
    }

    private async isItOkayToMerge(repository: Repository): Promise<boolean> {
        if (
            (await interaction.checkThenWarnOutstandingMerge(repository)) ||
            (await interaction.checkThenErrorUnclean(
                repository,
                WarnScenario.Merge
            ))
        ) {
            this.focusScm();
            return false;
        }
        return true;
    }

    private async mergeCommon(
        repository: Repository,
        mergeAction: MergeAction,
        placeholder: string
    ): Promise<void> {
        if (!(await this.isItOkayToMerge(repository))) {
            return;
        }

        const openedBranches = await repository.getBranches();
        const branch = await interaction.pickBranch(
            openedBranches,
            placeholder
        );
        if (branch) {
            return this.doMerge(repository, branch, mergeAction);
        }
    }

    @command('fossil.merge', { repository: true })
    async merge(repository: Repository): Promise<void> {
        const placeholder = localize(
            'choose branch',
            'Choose branch to merge into working directory:'
        );
        return this.mergeCommon(repository, MergeAction.Merge, placeholder);
    }

    @command('fossil.integrate', { repository: true })
    async integrate(repository: Repository): Promise<void> {
        const placeholder = localize(
            'choose branch integrate',
            'Choose branch to integrate into working directory:'
        );
        return this.mergeCommon(repository, MergeAction.Integrate, placeholder);
    }

    @command('fossil.cherrypick', { repository: true })
    async cherrypick(repository: Repository): Promise<void> {
        if (!(await this.isItOkayToMerge(repository))) {
            return;
        }
        const logEntries = await repository.getLogEntries();
        const checkin = await interaction.pickCommitToCherrypick(logEntries);

        if (checkin) {
            return this.doMerge(repository, checkin, MergeAction.Cherrypick);
        }
    }

    private async doMerge(
        repository: Repository,
        otherRevision: FossilCheckin,
        mergeAction: MergeAction
    ) {
        try {
            const result = await repository.merge(otherRevision, mergeAction);
            const { currentBranch } = repository;

            if (result.unresolvedCount > 0) {
                interaction.warnUnresolvedFiles(result.unresolvedCount);
            } else if (currentBranch) {
                const defaultMergeMessage = humanise.describeMerge(
                    currentBranch,
                    otherRevision
                );
                const didCommit = await this.smartCommit(
                    repository,
                    async () =>
                        await interaction.inputCommitMessage(
                            defaultMergeMessage
                        )
                );

                if (didCommit) {
                    repository.sourceControl.inputBox.value = '';
                }
            }
        } catch (e) {
            if (
                e instanceof FossilError &&
                e.fossilErrorCode === 'UntrackedFilesDiffer' &&
                e.untrackedFilenames
            ) {
                interaction.errorUntrackedFilesDiffer(e.untrackedFilenames);
                return;
            }

            throw e;
        }
    }

    @command('fossil.closeBranch', { repository: true })
    async closeBranch(repository: Repository): Promise<void> {
        const openedBranches = await repository.getBranches();
        const placeholder = localize('branchtoclose', 'Branch to close');
        const branch = await interaction.pickBranch(
            openedBranches,
            placeholder
        );
        if (branch) {
            return repository.addTag(branch, 'closed');
        }
    }

    @command('fossil.reopenBranch', { repository: true })
    async reopenBranch(repository: Repository): Promise<void> {
        const openedBranches = await repository.getBranches({ closed: true });
        const placeholder = localize('branchtoreopen', 'Branch to reopen');
        const branch = await interaction.pickBranch(
            openedBranches,
            placeholder
        );
        if (branch) {
            return repository.cancelTag(branch, 'closed');
        }
    }

    @command('fossil.push', { repository: true })
    async push(repository: Repository): Promise<void> {
        await repository.push(undefined);
    }

    @command('fossil.pushTo', { repository: true })
    async pushTo(repository: Repository): Promise<void> {
        const path = await repository.getPath();

        if (!path.url) {
            return interaction.warnNoPaths('push');
        }
        repository.push(path.url);
    }

    @command('fossil.showOutput')
    showOutput(): void {
        this.outputChannel.show();
    }

    @command('fossil.openUI', { repository: true })
    async openUI(repository: Repository): Promise<void> {
        const terminal = window.createTerminal({
            name: 'Fossil UI',
            cwd: repository.root,
        });
        terminal.sendText('fossil ui', true);
        //  await commands.executeCommand<void>(
        //     'simpleBrowser.show',
        //     'http://127.0.0.1:8000'
        //     );
    }

    @command('fossil.log', { repository: true })
    async log(repository: Repository): Promise<void> {
        await interaction.presentLogSourcesMenu(repository);
    }

    @command('fossil.fileLog')
    async fileLog(uri?: Uri): Promise<void> {
        if (!uri) {
            uri = window.activeTextEditor?.document.uri;
        }
        if (!uri || uri.scheme !== 'file') {
            return;
        }

        const repository = this.model.getRepository(uri);
        if (!repository) {
            return;
        }

        const onCommitPicked = (checkin: FossilCheckin) => async () => {
            await interaction.pickDiffAction(
                logEntries,
                (to: FossilHash | FossilSpecialTags | undefined) =>
                    (): Promise<void> =>
                        this.diff(repository, checkin, to, uri!),
                this.fileLog
            );
        };

        const logEntries = await repository.getLogEntries({ fileUri: uri });
        const choice = await interaction.pickCommit(
            CommitSources.File,
            logEntries,
            onCommitPicked
        );

        if (choice) {
            await choice.run();
        }
    }

    @command('fossil.revertChange')
    async revertChange(
        uri: Uri,
        changes: LineChange[],
        index: number
    ): Promise<void> {
        if (!uri) {
            return;
        }
        const textEditor = window.visibleTextEditors.filter(
            e => e.document.uri.toString() === uri.toString()
        )[0];
        if (!textEditor) {
            return;
        }
        await revertChanges(textEditor, [
            ...changes.slice(0, index),
            ...changes.slice(index + 1),
        ]);
        const firstStagedLine = changes[index].modifiedStartLineNumber - 1;
        textEditor.selections = [
            new Selection(firstStagedLine, 0, firstStagedLine, 0),
        ];
    }

    @command('fossil.render')
    async render(uri: Uri, _info: { groupId: number }): Promise<void> {
        return this.previewManager.openDynamicPreview(uri);
    }

    @command('fossil.wikiCreate')
    async wikiCreate(): Promise<void> {
        const preview = this.previewManager.activePreview;
        if (preview) {
            const where = await interaction.inputWikiType();
            if (where) {
                const comment = await interaction.inputWikiComment(where);
                if (comment) {
                    const successfully_created = await preview.wikiCreate(
                        where,
                        comment
                    );
                    if (successfully_created) {
                        await window.showInformationMessage(
                            `${where} was successfully created`
                        );
                    } else {
                        await window.showErrorMessage(
                            `${where} creation failed`
                        );
                    }
                }
            }
        } else {
            this.outputChannel.appendLine(
                "couldn't create wiki entity - no active preview"
            );
        }
    }

    private async diff(
        repository: Repository,
        checkin: FossilCheckin,
        target: FossilHash | FossilSpecialTags | undefined,
        uri: Uri
    ) {
        const fromUri = toFossilUri(uri, checkin);
        switch (target) {
            case 'parent':
                target = await repository.getInfo(checkin, 'parent');
                break;
        }
        const toUri = toFossilUri(uri, target);
        const fromName = checkin.slice(0, 12);
        const toName = (target || 'local').slice(0, 12);
        const relativePath = repository.mapFileUriToWorkspaceRelativePath(uri);
        const title = `${relativePath} (${fromName} vs. ${toName})`;

        return commands.executeCommand<void>(
            'vscode.diff',
            fromUri,
            toUri,
            title
        );
    }

    public guessRepository(arg: any): Promise<Repository | undefined> {
        const repository = this.model.getRepository(arg);
        let repositoryPromise: Promise<Repository | undefined>;

        if (repository) {
            repositoryPromise = Promise.resolve(repository);
        } else if (this.model.repositories.length === 1) {
            repositoryPromise = Promise.resolve(this.model.repositories[0]);
        } else {
            repositoryPromise = this.model.pickRepository();
        }
        return repositoryPromise;
    }

    private getSCMResource(uri?: Uri): FossilResource | undefined {
        uri = uri
            ? uri
            : window.activeTextEditor && window.activeTextEditor.document.uri;

        if (!uri) {
            return undefined;
        }

        if (uri.scheme === 'fossil') {
            uri = uri.with({ scheme: 'file' });
        }

        if (uri.scheme === 'file') {
            const repository = this.model.getRepository(uri);

            if (!repository) {
                return undefined;
            }

            return (
                repository.workingGroup.getResource(uri) ||
                repository.stagingGroup.getResource(uri) ||
                repository.untrackedGroup.getResource(uri) ||
                repository.mergeGroup.getResource(uri) ||
                repository.conflictGroup.getResource(uri)
            );
        }
        return undefined;
    }

    // private runByRepository<T>(resource: Uri, fn: (repository: Repository, resource: Uri) => Promise<T>): Promise<T[]>;
    // private runByRepository<T>(resources: Uri[], fn: (repository: Repository, resources: Uri[]) => Promise<T>): Promise<T[]>;
    // private async runByRepository<T>(arg: Uri | Uri[], fn: (repository: Repository, resources: any) => Promise<T>): Promise<T[]> {
    //     const resources = arg instanceof Uri ? [arg] : arg;
    //     const isSingleResource = arg instanceof Uri;

    //     const groups = resources.reduce((result, resource) => {
    //         const repository = this.model.getRepository(resource);

    //         if (!repository) {
    //             console.warn('Could not find fossil repository for ', resource);
    //             return result;
    //         }

    //         const tuple = result.filter(p => p[0] === repository)[0];

    //         if (tuple) {
    //             tuple.resources.push(resource);
    //         } else {
    //             result.push({ repository, resources: [resource] });
    //         }

    //         return result;
    //     }, [] as { repository: Repository, resources: Uri[] }[]);

    //     const promises = groups
    //         .map(({ repository, resources }) => fn(repository as Repository, isSingleResource ? resources[0] : resources));

    //     return Promise.all(promises);
    // }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
    }
}
