/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ben Crowl. All rights reserved.
 *  Original Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {Uri, commands, scm, Disposable, window, workspace, OutputChannel,
        SourceControlResourceState, SourceControl, SourceControlResourceGroup,
        TextDocumentShowOptions, ViewColumn } from "vscode";
import * as nls from "vscode-nls";
import * as path from "path";
import { Ref, Fossil, Commit, FossilError, FossilErrorCodes, IFileStatus, CommitDetails } from "./fossilBase";
import { Model } from "./model";
import { Resource, Status, CommitOptions, CommitScope, MergeStatus, LogEntriesOptions, Repository } from "./repository"
import { WorkingDirectoryGroup, StagingGroup, MergeGroup, UntrackedGroup, isResourceGroup } from "./resourceGroups";
import { interaction, BranchExistsAction, WarnScenario, CommitSources, LogMenuAPI } from "./interaction";
import { humanise } from "./humanise"
import { partition } from "./util";
import { toFossilUri } from "./uri";

const localize = nls.loadMessageBundle();

interface Command {
    commandId: string;
    key: string;
    method: Function;
    options: CommandOptions;
}

interface CommandOptions {
    repository?: boolean;
    diff?: boolean;
}

const Commands: Command[] = [];

function command(commandId: string, options: CommandOptions = {}): Function {
    return (target: any, key: string, descriptor: any) => {
        if (!(typeof descriptor.value === 'function')) {
            throw new Error('not supported');
        }

        Commands.push({ commandId, key, method: descriptor.value, options });
    };
}

export class CommandCenter {

    private model: Model;
    private disposables: Disposable[];

    constructor(
        private fossil: Fossil,
        model: Model | undefined,
        private outputChannel: OutputChannel
    ) {
        if (model) {
            this.model = model;
        }

        this.disposables = Commands.map(({ commandId, key, method, options }) => {
            const command = this.createCommand(commandId, key, method, options);

            // if (options.diff) {
            //  return commands.registerDiffInformationCommand(commandId, command);
            // } else {
            return commands.registerCommand(commandId, command);
            // }
        });
    }

    @command('fossil.refresh', { repository: true })
    async refresh(repository: Repository): Promise<void> {
        await repository.status();
    }

    @command('fossil.openResource')
    async openResource(resource: Resource): Promise<void> {
        await this._openResource(resource, undefined, true, false);
    }

    private async _openResource(resource: Resource | undefined, preview?: boolean, preserveFocus?: boolean, preserveSelection?: boolean): Promise<void> {
        if(!resource) return;
        const left = this.getLeftResource(resource);
        const right = this.getRightResource(resource);
        const title = this.getTitle(resource);

        const opts: TextDocumentShowOptions = {
            preserveFocus,
            preview,
            viewColumn: ViewColumn.Active
        };

        const activeTextEditor = window.activeTextEditor;

        // Check if active text editor has same path as other editor. we cannot compare via
        // URI.toString() here because the schemas can be different. Instead we just go by path.
        if (preserveSelection && activeTextEditor && activeTextEditor.document.uri.path === right.path) {
            opts.selection = activeTextEditor.selection;
        }

        if (!left) {
            const document = await workspace.openTextDocument(right);
            await window.showTextDocument(document, opts);
            return;
        }
        return await commands.executeCommand<void>('vscode.diff', left, right, title, opts);
    }

    private getLeftResource(resource: Resource): Uri | undefined {
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

    private getRightResource(resource: Resource): Uri {
        if (resource.mergeStatus === MergeStatus.UNRESOLVED &&
            resource.status !== Status.MISSING &&
            resource.status !== Status.DELETED) {
            return resource.resourceUri.with({ scheme: 'fossil' });
        }

        switch (resource.status) {
            case Status.DELETED:
            case Status.MISSING:
                return resource.resourceUri.with({ scheme: 'fossil', query: 'empty' });

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

    private getTitle(resource: Resource): string {
        const basename = path.basename(resource.resourceUri.fsPath);
        if (resource.mergeStatus === MergeStatus.UNRESOLVED &&
            resource.status !== Status.MISSING &&
            resource.status !== Status.DELETED) {
            return `${basename} (local <-> other)`
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
        var url = await interaction.inputRepoUrl();
        if (!url) {
            return;
        }
        const username = await interaction.inputCloneUser();
        var userauth: string | undefined;
        if (username) {
            userauth = await interaction.inputCloneUserAuth();
        }
        if (userauth){
            const regex = (url.search('@') < 0) ? /(^.+\:\/\/)(.+)/ : /(^.+\:\/\/).*@(.+)/
            const match = url.match(regex);
            if(match){
                url = match[1] + username + ':' + userauth + '@' + match[2]
            }
        }
        const parentPath = await interaction.inputCloneParentPath();
        if (!parentPath) {
            return;
        }

        const clonePromise = this.fossil.clone(url, parentPath);
        interaction.statusCloning(clonePromise);

        try {
            const repositoryPath = await clonePromise;
            const openClonedRepo = await interaction.promptOpenClonedRepo();
            if (openClonedRepo) {
                this.fossil.openClone(repositoryPath, parentPath)
            }
        }
        catch (err) {
            throw err;
        }
    }

    @command('fossil.init')
    async init(): Promise<void> {
        const result = await interaction.openFileDialog(false, true, false, localize('init repo', 'Respository Folder'))

        if (!result || result.length === 0) {
            return;
        }

        const uri = result[0];
        const path = uri.fsPath;
        const fileName = await interaction.inputRepoName()
        if(fileName && fileName.length){
            await this.fossil.init(path, fileName);
            const openClonedRepo = await interaction.promptOpenClonedRepo();
            if (openClonedRepo) {
                this.fossil.openClone(fileName, path)
            }
        }
        await this.model.tryOpenRepository(path);
    }

    @command('fossil.close', { repository: true})
    async close(repository: Repository): Promise<void> {
        this.model.close(repository);
    }

    @command('fossil.openFiles')
    openFiles(...resources: (Resource | SourceControlResourceGroup)[]): Promise<void> {
        if (resources.length === 1) {
            // a resource group proxy object?
            const [resourceGroup] = resources;
            if (isResourceGroup(resourceGroup)) {
                const groupId = resourceGroup.id
                const resources = resourceGroup.resourceStates as Resource[];
                return this.openFile(...resources);
            }
        }

        return this.openFile(...<Resource[]>resources);
    }

    @command('fossil.openFile')
    async openFile(...resources: Resource[]): Promise<void> {
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
                viewColumn: ViewColumn.Active
            };

            // Check if active text editor has same path as other editor. we cannot compare via
            // URI.toString() here because the schemas can be different. Instead we just go by path.
            if (activeTextEditor && activeTextEditor.document.uri.path === uri.path) {
                opts.selection = activeTextEditor.selection;
            }

            const document = await workspace.openTextDocument(uri);
            await window.showTextDocument(document, opts);
        }
    }

    @command('fossil.openChange')
    async openChange(...resources: Resource[]): Promise<void> {
        if (!resources) {
            return;
        }

        if (resources.length === 1) {
            // a resource group proxy object?
            const [resourceGroup] = resources;
            if (isResourceGroup(resourceGroup)) {
                const groupId = resourceGroup.id;
                const resources = resourceGroup.resourceStates as Resource[];
                return this.openChange(...resources);
            }
        }

        const preview = resources.length === 1 ? undefined : false;
        for (let resource of resources) {
            await this._openResource(resource, preview, true, false);
        }
    }

    @command('fossil.openFileFromUri')
    async openFileFromUri(uri?: Uri): Promise<void> {
        const resource = this.getSCMResource(uri);

        if (!resource) {
            return;
        }

        return await this.openFile(resource);
    }

    @command('fossil.openChangeFromUri')
    async openChangeFromUri(uri?: Uri): Promise<void> {
        const resource = this.getSCMResource(uri);

        if (!resource) {
            return;
        }

        return await this._openResource(resource);
    }

    @command('fossil.ignore')
    async ignore(...resourceStates: SourceControlResourceState[]): Promise<void> {
        if (resourceStates.length === 0) {
            const resource = this.getSCMResource();

            if (!resource) {
                return;
            }

            resourceStates = [resource];
        }

        const scmResources = resourceStates
            .filter(s => s instanceof Resource && s.resourceGroup instanceof UntrackedGroup) as Resource[];

        if (!scmResources.length) {
            return;
        }

        const resources = scmResources.map(r => r.resourceUri);
        const repository = this.model.getRepository(resources[0])
        if (repository){
            await repository.ignore(...resources)
        }
        // await this.runByRepository(resources, async (repository, uris) => repository.ignore(...uris));
    }

    @command('fossil.addAll', { repository: true })
    async addAll(repository: Repository): Promise<void> {
        return await repository.add();
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

        const scmResources = resourceStates
            .filter(s => s instanceof Resource && s.resourceGroup instanceof UntrackedGroup) as Resource[];

        if (!scmResources.length) {
            return;
        }

        const resources = scmResources.map(r => r.resourceUri);
        const repository = this.model.getRepository(resources[0])
        if (repository){
            await repository.add(...resources)
        }
    }

    @command('fossil.remove')
    async remove(...resourceStates: SourceControlResourceState[]): Promise<void> {
        if (resourceStates.length === 0) {
            const resource = this.getSCMResource();

            if (!resource) {
                return;
            }

            resourceStates = [resource];
        }

        const scmResources = resourceStates
            .filter(s => s instanceof Resource && s.resourceGroup instanceof WorkingDirectoryGroup) as Resource[];

        if (!scmResources.length) {
            return;
        }

        const resources = scmResources.map(r => r.resourceUri);
        const repository = this.model.getRepository(resources[0])
        if (repository){
            await repository.remove(...resources)
        }
        // await this.runByRepository(resources, async (repository, uris) => repository.remove(...uris));
    }

    @command('fossil.stage') // run by repo
    async stage(...resourceStates: SourceControlResourceState[]): Promise<void> {
        if (resourceStates.length === 0) {
            const resource = this.getSCMResource();

            if (!resource) {
                return;
            }

            resourceStates = [resource];
        }

        const scmResources = resourceStates
            .filter(s => s instanceof Resource &&
                        (
                            s.resourceGroup instanceof WorkingDirectoryGroup
                            || s.resourceGroup instanceof MergeGroup
                            || s.resourceGroup instanceof UntrackedGroup
                        )
                    ) as Resource[];

        if (!scmResources.length) {
            return;
        }

        const resources = scmResources.map(r => r.resourceUri);
        const repository = this.model.getRepository(resources[0])
        if (repository){
            await repository.stage(...resources)
        }
        // await this.runByRepository(resources, async (repository, uris) => repository.stage(...uris));
    }

    @command('fossil.stageAll', { repository: true })
    async stageAll(repository: Repository): Promise<void> {
        await repository.stage();
    }

    @command('fossil.unstage')
    async unstage(...resourceStates: SourceControlResourceState[]): Promise<void> {
        if (resourceStates.length === 0) {
            const resource = this.getSCMResource();

            if (!resource) {
                return;
            }

            resourceStates = [resource];
        }

        const scmResources = resourceStates.filter(s =>
            s instanceof Resource &&
            s.resourceGroup instanceof StagingGroup) as Resource[];

        if (!scmResources.length) {
            return;
        }

        const resources = scmResources.map(r => r.resourceUri);
        const repository = this.model.getRepository(resources[0])
        if (repository){
            await repository.unstage(...resources)
        }
        // await this.runByRepository(resources, async (repository, uris) => repository.unstage(...uris));
    }

    @command('fossil.unstageAll', { repository: true })
    async unstageAll(repository: Repository): Promise<void> {
        return await repository.unstage();
    }

    @command('fossil.revert')
    async revert(...resourceStates: SourceControlResourceState[]): Promise<void> {
        if (resourceStates.length === 0) {
            const resource = this.getSCMResource();

            if (!resource) {
                return;
            }

            resourceStates = [resource];
        }

        const scmResources = resourceStates.filter(s =>
            s instanceof Resource &&
            s.isDirtyStatus) as Resource[];

        if (!scmResources.length) {
            return;
        }

        const [discardResources, addedResources] = partition(scmResources, s => s.status !== Status.ADDED);
        if (discardResources.length > 0) {
            const confirmFilenames = discardResources.map(r => path.basename(r.resourceUri.fsPath));
            const addedFilenames = addedResources.map(r => path.basename(r.resourceUri.fsPath));

            const confirmed = await interaction.confirmDiscardChanges(confirmFilenames, addedFilenames);
            if (!confirmed) {
                return;
            }
        }

        const resources = scmResources.map(r => r.resourceUri);
        const repository = this.model.getRepository(resources[0])
        if (repository){
            await repository.revert(...resources)
        }
        // await this.runByRepository(resources, async (repository, uris) => repository.revert(...uris));
    }

    @command('fossil.revertAll', { repository: true })
    async revertAll(repository: Repository): Promise<void> {
        if (await interaction.confirmDiscardAllChanges()) {
            const resources = repository.workingDirectoryGroup.resources;
            await repository.revert(...resources.map(r => r.resourceUri));
        }
    }

    @command('fossil.clean', { repository: true })
    async clean(repository: Repository): Promise<void> {
        if (await interaction.confirmDeleteExtras()) {
            await repository.clean();
        }
    }

    private async smartCommit(repository: Repository, getCommitMessage: () => Promise<string | undefined>, opts?: CommitOptions): Promise<boolean> {
        // validate no conflicts
        const numConflictResources = repository.conflictGroup.resources.length;
        if (numConflictResources > 0) {
            interaction.warnResolveConflicts();
            return false;
        }
        const numWorkingResources = repository.workingDirectoryGroup.resources.length;
        const numStagingResources = repository.stagingGroup.resources.length;
        const isMergeCommit = repository.repoStatus && repository.repoStatus.isMerge;

        if (isMergeCommit) {
            opts = { scope: CommitScope.ALL };
        }
        else {
            if (!opts || opts.scope === undefined) {
                if(numWorkingResources > 0 && numStagingResources == 0){
                    const confirm = await interaction.confirmCommitWorkingGroup()
                    if (confirm){
                        opts = { scope: CommitScope.CHANGES };
                    }
                    else return false;
                }
                else{
                    opts = { scope: CommitScope.STAGED_CHANGES };
                }
            }

            if (opts.scope === CommitScope.CHANGES) {
                const missingResources = repository.workingDirectoryGroup.resources.filter(r => r.status === Status.MISSING);
                if (missingResources.length > 0) {
                    const missingFilenames = missingResources.map(r => repository.mapResourceToWorkspaceRelativePath(r));
                    const deleteConfirmed = await interaction.confirmDeleteMissingFilesForCommit(missingFilenames);
                    if (!deleteConfirmed) {
                        return false;
                    }
                    await this.remove(...missingResources)
                }
            }

            if ((numWorkingResources === 0 && numStagingResources === 0) // no changes
                || (opts && opts.scope === CommitScope.STAGED_CHANGES && numStagingResources === 0) // no staged changes
                || (opts && opts.scope === CommitScope.CHANGES && numWorkingResources === 0) // no working directory changes
            ) {
                interaction.informNoChangesToCommit();
                return false;
            }
        }

        const message = await getCommitMessage();

        if (!message) {
            // TODO@joao: show modal dialog to confirm empty message commit
            return false;
        }

        await repository.commit(message, opts);

        return true;
    }


    private async commitWithAnyInput(repository: Repository, opts?: CommitOptions): Promise<void> {
        const message = scm.inputBox.value;
        const didCommit = await this.smartCommit(repository, () => interaction.inputCommitMessage(message), opts);

        if (message && didCommit) {
            scm.inputBox.value = "";
        }
    }

    @command('fossil.commit', { repository: true })
    async commit(repository: Repository): Promise<void> {
        await this.commitWithAnyInput(repository);
    }

    @command('fossil.commitWithInput', { repository: true })
    async commitWithInput(repository: Repository): Promise<void> {
        const didCommit = await this.smartCommit(repository, async () => repository.sourceControl.inputBox.value);

        if (didCommit) {
            scm.inputBox.value = "";
        }
    }

    @command('fossil.commitStaged', { repository: true })
    async commitStaged(repository: Repository): Promise<void> {
        await this.commitWithAnyInput(repository, { scope: CommitScope.STAGED_CHANGES });
    }

    @command('fossil.commitAll', { repository: true })
    async commitAll(repository: Repository): Promise<void> {
        await this.commitWithAnyInput(repository, { scope: CommitScope.ALL });
    }

    private focusScm() {
        commands.executeCommand("workbench.view.scm");
    }

    @command('fossil.undo', { repository: true })
    async undo(repository: Repository): Promise<void> {
        try {
            const undo = await repository.undo(true); // dry-run
            if (await interaction.confirmUndo(undo)) {
                await repository.undo(false); // real-thing
            }
        }
        catch (e) {
            if (e instanceof FossilError && e.fossilErrorCode === FossilErrorCodes.NoUndoInformationAvailable) {
                await interaction.warnNoUndo();
            }
        }
    }

    @command('fossil.update', { repository: true })
    async update(repository: Repository): Promise<void> {
        let refs: Ref[];
        let unclean = false;

        // branches/tags
        if (await interaction.checkThenWarnOutstandingMerge(repository, WarnScenario.Update) ||
            await interaction.checkThenErrorUnclean(repository, WarnScenario.Update)) {
            this.focusScm();
            return;
        }
        refs = await repository.getRefs();

        const choice = await interaction.pickUpdateRevision(refs, unclean);

        if (choice) {
            await choice.run(repository);
        }
    }

    @command('fossil.branchChange', { repository: true })
    async branchChange(repository: Repository): Promise<void> {
        let refs: Ref[];
        let unclean = false;

        // branches/tags
        if (await interaction.checkThenWarnOutstandingMerge(repository, WarnScenario.Update)) {
            this.focusScm();
            return;
        }
        await interaction.checkThenWarnUnclean(repository, WarnScenario.Update)
        refs = await repository.getRefs();

        const choice = await interaction.pickUpdateRevision(refs, unclean);

        if (choice) {
            await choice.run(repository);
        }
    }

    @command('fossil.branch', { repository: true })
    async branch(repository: Repository): Promise<void> {
        const result = await interaction.inputBranchName();
        if (!result) {
            return;
        }

        const name = result.replace(/^\.|\/\.|\.\.|~|\^|:|\/$|\.lock$|\.lock\/|\\|\*|\s|^\s*$|\.$/g, '-');
        try {
            await repository.branch(name);
        }
        catch (e) {
            if (e instanceof FossilError && e.fossilErrorCode === FossilErrorCodes.BranchAlreadyExists) {
                const action = await interaction.warnBranchAlreadyExists(name);
                if (action === BranchExistsAction.Reopen) {
                    await repository.branch(name, { allowBranchReuse: true });
                }
                else if (action === BranchExistsAction.UpdateTo) {
                    await repository.update(name);
                }
            }
        }
    }

    @command('fossil.pull', { repository: true })
    async pull(repository: Repository): Promise<void> {
        const paths = await repository.getPath();

        if (paths.url == "") {
            await interaction.warnNoPaths('pull');
            return;
        }

        const pullOptions = await repository.createPullOptions();
        await repository.pull(pullOptions);
    }

    @command('fossil.mergeWithLocal', { repository: true })
    async mergeWithLocal(repository: Repository) {
        if (await interaction.checkThenWarnOutstandingMerge(repository, WarnScenario.Merge) ||
            await interaction.checkThenErrorUnclean(repository, WarnScenario.Merge)) {
            this.focusScm();
            return;
        }

        const otherHeads = await repository.getBranches();
        const placeholder = localize('choose branch', "Choose branch to merge into working directory:");
        const branch = await interaction.pickHead(otherHeads, placeholder);
        if (branch && branch.name) {
            return await this.doMerge(repository, branch.name, branch.name);
        }
    }

    @command('fossil.mergeHeads', { repository: true })
    async mergeHeads(repository: Repository) {
        if (await interaction.checkThenWarnOutstandingMerge(repository, WarnScenario.Merge) ||
            await interaction.checkThenErrorUnclean(repository, WarnScenario.Merge)) {
            this.focusScm();
            return;
        }

        const otherHeads = await repository.getBranches();
        if (otherHeads.length === 0) {
            // 1 head
            interaction.warnMergeOnlyOneHead();
            return;
        }
        else {
            // 2+ heads
            const placeHolder = localize('choose branch', "Choose branch to merge with:");
            const head = await interaction.pickHead(otherHeads, placeHolder);
            if (head && head.name) {
                return await this.doMerge(repository, head.name);
            }
        }
    }

    private async doMerge(repository: Repository, otherRevision: string, otherBranchName?: string) {
        try {
            const result = await repository.merge(otherRevision);
            const { currentBranch } = repository;

            if (result.unresolvedCount > 0) {
                interaction.warnUnresolvedFiles(result.unresolvedCount);
            }
            else if (currentBranch) {
                const defaultMergeMessage = await humanise.describeMerge(currentBranch.name!, otherBranchName);
                const didCommit = await this.smartCommit(repository, async () => await interaction.inputCommitMessage("", defaultMergeMessage));

                if (didCommit) {
                    scm.inputBox.value = "";
                }
            }
        }
        catch (e) {
            if (e instanceof FossilError && e.fossilErrorCode === FossilErrorCodes.UntrackedFilesDiffer && e.hgFilenames) {
                interaction.errorUntrackedFilesDiffer(e.hgFilenames);
                return;
            }

            throw e;
        }
    }

    @command('fossil.push', { repository: true })
    async push(repository: Repository): Promise<void> {
        await repository.push(undefined);
    }

    @command('fossil.pushTo', { repository: true })
    async pushTo(repository: Repository): Promise<void> {
        const path = await repository.getPath();

        if (path.url == "") {
            await interaction.warnNoPaths('push');
            return;
        }
        repository.push(path.url);
    }

    @command('fossil.showOutput', { repository: true })
    showOutput(): void {
        this.outputChannel.show();
    }

    createLogMenuAPI(repository: Repository): LogMenuAPI {
        return {
            getRepoName: () => repository.repoName,
            getBranchName: () => repository.currentBranch && repository.currentBranch.name,
            getCommitDetails: (revision: string) => repository.getCommitDetails(revision),
            getLogEntries: (options: LogEntriesOptions) => repository.getLogEntries(options),
            diffToLocal: (file: IFileStatus, commit: CommitDetails) => { },
            diffToParent: (file: IFileStatus, commit: CommitDetails) => this.diffFile(repository, commit.parent1, commit.hash, file)
        }
    }

    @command('fossil.log', { repository: true })
    async log(repository: Repository) {
        interaction.presentLogSourcesMenu(this.createLogMenuAPI(repository));
    }

    @command('fossil.logBranch', { repository: true })
    async logBranch(repository: Repository) {
        interaction.presentLogMenu(CommitSources.Branch, { }, this.createLogMenuAPI(repository));
    }

    @command('fossil.logDefault', { repository: true })
    async logDefault(repository: Repository) {
        interaction.presentLogMenu(CommitSources.Branch, { }, this.createLogMenuAPI(repository));
    }

    @command('fossil.logRepo', { repository: true })
    async logRepo(repository: Repository) {
        interaction.presentLogMenu(CommitSources.Repo, {}, this.createLogMenuAPI(repository));
    }

    @command('fossil.fileLog')
    async fileLog(uri?: Uri) {
        if (!uri) {
            if (window.activeTextEditor) {
                uri = window.activeTextEditor.document.uri;
            }

            if (!uri || uri.scheme !== 'file') {
                return;
            }
        }

        const repository = this.model.getRepository(uri);
        if (!repository) {
            return;
        }

        const logEntries = await repository.getLogEntries({ file: uri });
        const choice = await interaction.pickCommit(CommitSources.File, logEntries, commit => () => {
            if (uri) {
                this.diff(commit, uri);
            }
        });

        if (choice) {
            choice.run();
        }
    }

    private async diffFile(repository: Repository, rev1: string, rev2: string, file: IFileStatus) {
        const uri = repository.toUri(file.path);
        const left = uri.with({ scheme: 'fossil', query: rev1 });
        const right = uri.with({ scheme: 'fossil', query: rev2 });
        const baseName = path.basename(uri.fsPath);
        const title = `${baseName} (#${rev1} vs. ${rev2})`;

        if (left && right) {
            return await commands.executeCommand<void>('vscode.diff', left, right, title);
        }
    }

    private async diff(commit: Commit, uri: Uri) {
        const left = uri.with({ scheme: 'fossil', query: commit.hash });
        const right = uri;
        const baseName = path.basename(uri.fsPath);
        const title = `${baseName} (#${commit.revision} vs. local)`;

        if (left && right) {
            return await commands.executeCommand<void>('vscode.diff', left, right, title);
        }
    }

    private createCommand(id: string, key: string, method: Function, options: CommandOptions): (...args: any[]) => Promise<any> | undefined {
        const res = async (...args: SourceControl[]) => {
            let result: Promise<any>;
            if (!options.repository) {
                result = Promise.resolve(method.apply(this, args));
            } else {
                // try to guess the repository based on the first argument
                const repository = this.model.getRepository(args[0]);
                let repositoryPromise: Promise<Repository | undefined>;

                if (repository) {
                    repositoryPromise = Promise.resolve(repository);
                } else if (this.model.repositories.length === 1) {
                    repositoryPromise = Promise.resolve(this.model.repositories[0]);
                } else {
                    repositoryPromise = this.model.pickRepository();
                }

                result = repositoryPromise.then(repository => {
                    if (!repository) {
                        return Promise.resolve();
                    }

                    return Promise.resolve(method.apply(this, [repository, ...args]));
                });
            }

            try {
                return result;
            }
            catch (err) {
                const openLog = await interaction.errorPromptOpenLog(err);
                if (openLog) {
                    this.outputChannel.show();
                }
                else {
                    this.focusScm();
                }
            }
        };

        // patch this object, so people can call methods directly
        this[key] = res;
        return res;
    }

    private getSCMResource(uri?: Uri): Resource | undefined {
        uri = uri ? uri : window.activeTextEditor && window.activeTextEditor.document.uri;

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

            return repository.workingDirectoryGroup.getResource(uri)
                || repository.stagingGroup.getResource(uri)
                || repository.untrackedGroup.getResource(uri)
                || repository.mergeGroup.getResource(uri)
                || repository.conflictGroup.getResource(uri);
        }
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