/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ben Crowl. All rights reserved.
 *  Original Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vscode-nls';
import * as path from 'path';
import * as os from 'os';
import {
    window,
    QuickPickItem,
    workspace,
    ViewColumn,
    Uri,
    Disposable,
    QuickPickItemKind,
    InputBoxOptions,
} from 'vscode';
import {
    Commit,
    LogEntryOptions,
    CommitDetails,
    IFileStatus,
    FossilPath,
    FossilRoot,
    FossilURI,
    FossilBranch,
    BranchDetails,
    FossilTag,
    FossilCheckin,
    FossilHash,
    FossilSpecialTags,
    FossilUndoCommand,
} from './fossilBase';
import { humanise } from './humanise';
import { Repository, LogEntriesOptions } from './repository';
const localize = nls.loadMessageBundle();

const SHORT_HASH_LENGTH = 12;
const LONG_HASH_LENGTH = SHORT_HASH_LENGTH * 2;
const BULLET = '\u2022';
const NBSP = '\u00a0';

export const enum BranchExistsAction {
    None,
    Reopen,
    UpdateTo,
}
export const enum PushCreatesNewHeadAction {
    None,
    Pull,
}
export const enum WarnScenario {
    Merge,
    Update,
}
export const enum CommitSources {
    File,
    Branch,
    Repo,
}

export namespace interaction {
    /**
     * @returns workspaceDir/(default_name + postfix)
     */
    function suggestPath(default_name = 'repo_name', postfix = '.fossil'): Uri {
        const folders = workspace.workspaceFolders;
        if (folders?.length) {
            const dir = folders[0].uri;
            return Uri.joinPath(
                dir,
                (path.basename(dir.fsPath) || default_name) + postfix
            );
        }
        return Uri.joinPath(Uri.file(os.homedir()), default_name + postfix);
    }

    /** ask user for the new .fossil file location */
    export async function selectNewFossilPath(
        saveLabel: string
    ): Promise<FossilPath | undefined> {
        const defaultFossilFile = suggestPath();
        const uri = await window.showSaveDialog({
            defaultUri: defaultFossilFile,
            title: 'Select New Fossil File Location',
            saveLabel: saveLabel,
            filters: {
                'All files': ['*'],
            },
        });
        return uri?.fsPath as FossilPath;
    }

    /**
     * ask user to open existing .fossil file
     *
     * @returns fossil file uri
     */
    export async function selectExistingFossilPath(): Promise<
        FossilPath | undefined
    > {
        const defaultFossilFile = suggestPath();
        const uri = await window.showOpenDialog({
            defaultUri: defaultFossilFile,
            openLabel: 'Repository Location',
            filters: {
                'Fossil Files': ['fossil'],
                'All files': ['*'],
            },
            canSelectMany: false,
        });
        if (uri?.length) return uri[0].fsPath as FossilPath;
        return undefined;
    }

    export function statusCloning(clonePromise: Promise<any>): Disposable {
        return window.setStatusBarMessage(
            localize('cloning', 'Cloning fossil repository...'),
            clonePromise
        );
    }

    export function informNoChangesToCommit(
        this: void
    ): Thenable<string | undefined> {
        return window.showInformationMessage(
            localize('no changes', 'There are no changes to commit.')
        );
    }

    export async function checkThenWarnOutstandingMerge(
        repository: Repository
    ): Promise<boolean> {
        const { repoStatus } = repository;
        if (repoStatus && repoStatus.isMerge) {
            window.showErrorMessage(
                localize(
                    'outstanding merge',
                    'There is an outstanding merge in your working directory.'
                )
            );
            return true;
        }
        return false;
    }

    export async function checkThenErrorUnclean(
        repository: Repository,
        scenario: WarnScenario
    ): Promise<boolean> {
        if (!repository.isClean) {
            let nextStep = '';
            if (scenario === WarnScenario.Merge) {
                const discardAllChanges = localize(
                    'command.revertAll',
                    'Discard All Changes'
                );
                const abandonMerge = localize('abandon merge', 'abandon merge');
                nextStep = localize(
                    'use x to y',
                    'Use {0} to {1}',
                    discardAllChanges,
                    abandonMerge
                );
            }
            window.showErrorMessage(
                localize(
                    'not clean merge',
                    'There are uncommited changes in your working directory. {0}',
                    nextStep
                )
            );
            return true;
        }
        return false;
    }

    export async function checkThenWarnUnclean(
        repository: Repository,
        scenario: WarnScenario
    ): Promise<void> {
        if (!repository.isClean) {
            let nextStep = '';
            if (scenario === WarnScenario.Merge) {
                const discardAllChanges = localize(
                    'command.revertAll',
                    'Discard All Changes'
                );
                const abandonMerge = localize('abandon merge', 'abandon merge');
                nextStep = localize(
                    'use x to y',
                    'Use {0} to {1}',
                    discardAllChanges,
                    abandonMerge
                );
            }
            window.showWarningMessage(
                localize(
                    'not clean merge',
                    'There are uncommited changes in your working directory. {0}',
                    nextStep
                )
            );
        }
    }

    export async function warnPushCreatesNewHead(
        this: void
    ): Promise<PushCreatesNewHeadAction> {
        const warningMessage = localize(
            'pullandmerge',
            'Push would create new head. Try Pull and Merge first.'
        );
        const pullOption = localize('pull', 'Pull');
        const choice = await window.showErrorMessage(
            warningMessage,
            pullOption
        );
        if (choice === pullOption) {
            return PushCreatesNewHeadAction.Pull;
        }
        return PushCreatesNewHeadAction.None;
    }

    export async function warnNoPaths(type: 'pull' | 'push'): Promise<void> {
        await window.showErrorMessage(
            localize(
                `no paths to ${type}`,
                `Your repository has no paths configured for ${type}ing.`
            )
        );
    }

    export function warnResolveConflicts(
        this: void
    ): Thenable<string | undefined> {
        return window.showWarningMessage(
            localize('conflicts', 'Resolve conflicts before committing.')
        );
    }

    export function warnNoUndoOrRedo(
        this: void,
        command: 'undo' | 'redo'
    ): Thenable<string | undefined> {
        return window.showWarningMessage(
            localize(`no ${command}`, `Nothing to ${command}.`)
        );
    }

    export async function errorPromptOpenLog(err: any): Promise<boolean> {
        const hint = (err.stderr || err.message || String(err))
            .replace(/^abort: /im, '')
            .split(/[\r\n]/)
            .filter((line: string) => !!line)[0];

        const message = hint
            ? localize('fossil error details', 'Fossil: {0}', hint)
            : localize('fossil error', 'Fossil error');

        const openOutputChannelChoice = localize(
            'open fossil log',
            'Open Fossil Log'
        );
        const choice = await window.showErrorMessage(
            message,
            openOutputChannelChoice
        );
        return choice === openOutputChannelChoice;
    }

    export async function promptOpenClonedRepo(this: void): Promise<boolean> {
        const open = localize('openrepo', 'Open Repository');
        const result = await window.showInformationMessage(
            localize(
                'proposeopen',
                'Would you like to open the cloned repository?'
            ),
            open
        );
        return result === open;
    }

    export async function confirmOpenNotEmpty(
        this: void,
        dir: FossilRoot
    ): Promise<boolean> {
        const open = localize('openrepo', 'Open Repository');

        const message = localize(
            'proposeforceopen',
            'The directory {0} is not empty.\nOpen repository here anyway?',
            dir
        );
        const result = await window.showWarningMessage(
            message,
            { modal: true },
            open
        );
        return result === open;
    }

    export async function inputRepoUrl(
        this: void
    ): Promise<FossilURI | undefined> {
        const url = await window.showInputBox({
            value: 'https://fossil-scm.org/home',
            valueSelection: [8, 100],
            prompt: localize('repourl', 'Repository URI'),
            ignoreFocusOut: true,
        });
        return url as FossilURI;
    }

    export async function inputPrompt(
        msg: string
    ): Promise<string | undefined> {
        const title = 'Fossil Request';
        const panel = window.createWebviewPanel(
            'inputPrompt',
            title,
            ViewColumn.One
        );
        panel.webview.html = `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${title}</title>
        </head>
        <body>
            <pre>
            ${'\n\n\n' + msg}
            </pre>
        </body>
        </html>`;
        const lines = msg.split('\n');
        const resp = await window.showInputBox({
            prompt: localize('inputprompt', lines[lines.length - 1]),
            ignoreFocusOut: true,
        });
        panel.dispose();
        return resp;
    }

    async function inputCommon(
        this: void,
        key: string,
        message: string,
        extra: InputBoxOptions = {}
    ): Promise<string | undefined> {
        return window.showInputBox({
            prompt: localize(key, message),
            ignoreFocusOut: true,
            ...extra,
        });
    }

    export async function inputRepoName(
        this: void
    ): Promise<string | undefined> {
        return inputCommon(
            'repourl',
            "Repository Name (should end with '.fossil')"
        );
    }

    export async function inputProjectName(
        this: void
    ): Promise<string | undefined> {
        return inputCommon('project name', 'Project Name', {
            placeHolder: 'Leave empty to not set Project Name',
        });
    }

    export async function inputProjectDescription(
        this: void
    ): Promise<string | undefined> {
        return inputCommon('project description', 'Project Description', {
            placeHolder: 'Leave empty to not set Project Description',
        });
    }

    export async function inputPatchCreate(): Promise<string | undefined> {
        const defaultPatchFile = suggestPath('patch', '.fossilpatch');
        const uri = await window.showSaveDialog({
            defaultUri: defaultPatchFile,
            saveLabel: localize('Create', 'Create'),
            title: localize('new binary path', 'Create binary patch'),
        });
        return uri?.fsPath;
    }

    export async function inputPatchApply(
        this: void
    ): Promise<string | undefined> {
        const uris = await window.showOpenDialog({
            defaultUri: Uri.file('patch.fossilpatch'),
            canSelectMany: false,
            title: localize('new patch path', 'Create a patch'),
        });
        if (uris?.length == 1) {
            return uris[0].fsPath;
        }
        return undefined;
    }

    export async function selectFossilRootPath(
        this: void
    ): Promise<FossilRoot | undefined> {
        const default_uri = workspace.workspaceFolders
            ? workspace.workspaceFolders[0].uri
            : undefined;
        const uri = await window.showOpenDialog({
            defaultUri: default_uri,
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            title: localize('root_directory', 'Select Fossil Root Directory'),
        });
        if (uri?.length) return uri[0].fsPath as FossilRoot;
        return undefined;
    }

    export async function inputCloneUser(
        this: void
    ): Promise<string | undefined> {
        const auth = await window.showInputBox({
            prompt: localize('parent', 'Username '),
            placeHolder: 'None',
            ignoreFocusOut: true,
        });
        return auth;
    }

    export async function inputCloneUserAuth(
        this: void
    ): Promise<string | undefined> {
        const auth = await window.showInputBox({
            prompt: localize('parent', 'User Authentication'),
            placeHolder: 'None',
            password: true,
            ignoreFocusOut: true,
        });
        return auth;
    }

    export async function warnBranchAlreadyExists(
        name: string
    ): Promise<BranchExistsAction> {
        const updateTo = localize('upadte', 'Update');
        const reopen = localize('reopen', 'Re-open');
        const message = localize(
            'branch already exists',
            "Branch '{0}' already exists. Update or Re-open?",
            name
        );
        const choice = await window.showWarningMessage(
            message,
            { modal: true },
            updateTo,
            reopen
        );
        if (choice === reopen) {
            return BranchExistsAction.Reopen;
        } else if (choice === updateTo) {
            return BranchExistsAction.UpdateTo;
        }
        return BranchExistsAction.None;
    }

    export async function inputNewBranchName(
        this: void
    ): Promise<FossilBranch | undefined> {
        const input = await window.showInputBox({
            placeHolder: localize('branch name', 'Branch name'),
            prompt: localize(
                'provide branch name',
                'Please provide a branch name'
            ),
            ignoreFocusOut: true,
        });
        return input as FossilBranch | undefined;
    }

    export async function pickBranch(
        branches: BranchDetails[],
        placeHolder: string
    ): Promise<FossilBranch | undefined> {
        const headChoices = branches.map(head => new UpdateBranchItem(head));
        const choice = await window.showQuickPick(headChoices, { placeHolder });
        return choice?.checkin;
    }

    export async function pickUpdateRevision(
        refs: [BranchDetails[], FossilTag[]],
        unclean = false
    ): Promise<
        UpdatingItem<FossilBranch> | UpdatingItem<FossilTag> | undefined
    > {
        const branches = refs[0].map(ref => new UpdateBranchItem(ref));
        const tags = refs[1].map(ref => new UpdateTagItem(ref));
        const picks = [...branches, ...tags];
        const revType = 'branch/tag';

        const placeHolder = `Select a ${revType} to update to: ${
            unclean
                ? '(only showing local branches while working directory unclean)'
                : ''
        }`;
        const choice = await window.showQuickPick(picks, {
            placeHolder,
        });
        return choice;
    }

    function describeLogEntrySource(kind: CommitSources): string {
        switch (kind) {
            case CommitSources.Branch:
                return localize('branch history', 'Branch history');
            case CommitSources.Repo:
                return localize('repo history', 'Repo history');
            case CommitSources.File:
                return localize('file history', 'File history');
            default:
                return localize('history', 'History');
        }
    }

    function describeCommitOneLine(commit: Commit): string {
        return `#${commit.hash.slice(0, LONG_HASH_LENGTH)} ${BULLET} ${
            commit.author
        }, ${humanise.ageFromNow(commit.date)} ${BULLET} ${commit.message}`;
    }

    function asLabelItem(
        label: string,
        description = '',
        action: RunnableAction
    ): RunnableQuickPickItem {
        return new LiteralRunnableQuickPickItem(label, description, '', action);
    }

    function asBackItem(
        description: string,
        action: RunnableAction
    ): RunnableQuickPickItem {
        const goBack = localize('go back', 'go back');
        const to = localize('to', 'to');
        return new LiteralRunnableQuickPickItem(
            `$(arrow-left)${NBSP}${NBSP}${goBack}`,
            `${to} ${description}`,
            '',
            action
        );
    }

    export async function presentLogSourcesMenu(
        commands: LogMenuAPI
    ): Promise<void> {
        const branchName = commands.getBranchName();
        const source = await interaction.pickLogSource(branchName);
        if (source) {
            const historyScope = localize('history scope', 'history scope');
            const back = asBackItem(historyScope, () =>
                presentLogSourcesMenu(commands)
            );
            return presentLogMenu(
                source.source,
                source.options,
                commands,
                back
            );
        }
    }

    export async function presentLogMenu(
        source: CommitSources,
        logOptions: LogEntryOptions,
        commands: LogMenuAPI,
        back?: RunnableQuickPickItem
    ): Promise<void> {
        const entries = await commands.getLogEntries(logOptions);
        let result = await pickCommitAsShowCommitDetailsRunnable(
            source,
            entries,
            commands,
            back
        );
        while (result) {
            result = await result.run();
        }
    }

    async function pickCommitAsShowCommitDetailsRunnable(
        source: CommitSources,
        entries: Commit[],
        commands: LogMenuAPI,
        back?: RunnableQuickPickItem
    ): Promise<RunnableQuickPickItem | undefined> {
        const backhere = asBackItem(
            describeLogEntrySource(source).toLowerCase(),
            () =>
                pickCommitAsShowCommitDetailsRunnable(
                    source,
                    entries,
                    commands,
                    back
                )
        );
        const commitPickedActionFactory =
            (checkin: FossilCheckin) => async () => {
                const details = await commands.getCommitDetails(checkin);
                return interaction.presentCommitDetails(
                    details,
                    backhere,
                    commands
                );
            };

        const choice = await pickCommit(
            source,
            entries,
            commitPickedActionFactory,
            back
        );
        return choice;
    }

    /**
     * Present user with a list of Commit[]s
     *
     * @param source represent commit source
     * @param commits the commits
     * @param action what to do when commit is selected
     * @param backItem optional "back" action
     * @returns
     */
    export async function pickCommit(
        source: CommitSources,
        commits: Commit[],
        action: (commit: FossilCheckin) => RunnableAction,
        backItem?: RunnableQuickPickItem
    ): Promise<RunnableQuickPickItem | undefined> {
        const logEntryPickItems: RunnableQuickPickItem[] = commits.map(
            commit => new RunnableTimelineEntryItem(commit, action(commit.hash))
        );
        const current = new LiteralRunnableQuickPickItem(
            '$(tag) Current',
            '',
            'Current checkout',
            action('current')
        );
        logEntryPickItems.unshift(current);
        const placeHolder = describeLogEntrySource(source);
        const pickItems = backItem
            ? [backItem, ...logEntryPickItems]
            : logEntryPickItems;
        const choice = await window.showQuickPick(pickItems, {
            placeHolder,
            matchOnDescription: true,
            matchOnDetail: true,
        });

        return choice;
    }

    export async function pickCommitToCherrypick(
        logEntries: Commit[]
    ): Promise<FossilHash | undefined> {
        const logEntryPickItems = logEntries.map(
            entry => new TimelineEntryItem(entry)
        );
        const placeHolder = localize(
            'cherrypick commit',
            'Commit to cherrypick'
        );
        const choice = await window.showQuickPick(logEntryPickItems, {
            placeHolder,
            matchOnDescription: true,
            matchOnDetail: true,
        });
        return choice?.commit.hash;
    }

    /**
     * use selected commit in 'fossil.log' command
     */
    export async function presentCommitDetails(
        details: CommitDetails,
        back: RunnableQuickPickItem,
        commands: LogMenuAPI
    ): Promise<RunnableQuickPickItem | undefined> {
        const placeHolder = describeCommitOneLine(details);
        const fileActionFactory = (f: IFileStatus) => () => {
            return commands.diffToParent(f, details);
        };
        const filePickItems = details.files.map(
            f => new FileStatusQuickPickItem(f, fileActionFactory(f))
        );
        const backToSelfRunnable = () =>
            presentCommitDetails(details, back, commands);
        const items = [
            back,
            asLabelItem('Files', undefined, backToSelfRunnable),
            ...filePickItems,
        ];

        const choice = await window.showQuickPick<RunnableQuickPickItem>(
            items,
            {
                matchOnDescription: true,
                matchOnDetail: true,
                placeHolder,
            }
        );

        return choice;
    }

    export async function pickDiffAction(
        commits: Commit[],
        diffAction: (
            to: FossilHash | FossilSpecialTags | undefined
        ) => RunnableAction,
        backAction: RunnableAction
    ): Promise<void> {
        const items = [
            new LiteralRunnableQuickPickItem(
                '$(circle-outline) Parent',
                '',
                'Show what this commit changed',
                diffAction('parent')
            ),
            new LiteralRunnableQuickPickItem(
                '$(tag) Current',
                'special fossil tag',
                'Show difference with the current checked-out version ',
                diffAction('current')
            ),
            new LiteralRunnableQuickPickItem(
                '$(tag) Tip',
                'special fossil tag',
                'Show difference with the most recent check-in',
                diffAction('tip')
            ),
            new LiteralRunnableQuickPickItem(
                '$(circle-outline) Checkout',
                '',
                'Show differences with checkout',
                diffAction(undefined)
            ),
            new LiteralRunnableQuickPickItem(
                `$(arrow-left)${NBSP}${NBSP}Go back`,
                '',
                'Selct first commit',
                backAction
            ),
            {
                kind: QuickPickItemKind.Separator,
                label: '',
                run: () => {
                    /* separator acrion */
                },
                description: '',
            } as RunnableQuickPickItem,
            ...commits.map(
                commit =>
                    new RunnableTimelineEntryItem(
                        commit,
                        diffAction(commit.hash)
                    )
            ),
        ];
        const placeHolder = localize('compare with', 'Compare with');
        const choice = await window.showQuickPick(items, {
            placeHolder,
            matchOnDescription: true,
            matchOnDetail: true,
        });
        if (choice) {
            await choice.run();
        }
    }

    export async function pickLogSource(
        branchName: string | undefined
    ): Promise<LogSourcePickItem | undefined> {
        const branch: LogSourcePickItem = {
            label: `$(git-branch) ${branchName || '???'}`,
            source: CommitSources.Branch,
            options: {},
        };
        const default_: LogSourcePickItem = {
            label: '$(git-branch) default',
            source: CommitSources.Branch,
            options: {},
        };
        const repo: LogSourcePickItem = {
            label: '$(repo) entire repo',
            source: CommitSources.Repo,
            options: {},
        };

        const pickItems =
            branchName !== 'default'
                ? [branch, default_, repo]
                : [branch, repo];

        const choice = await window.showQuickPick<LogSourcePickItem>(
            pickItems,
            {
                placeHolder: localize('history for', 'Show history for...'),
            }
        );

        return choice;
    }

    // this function is unused but should be
    // export async function pickRemotePath(
    //     paths: FossilRemote[]
    // ): Promise<string | undefined> {
    //     const picks = paths.map(
    //         p => ({ label: p.name, description: p.url } as QuickPickItem)
    //     );
    //     const placeHolder = localize(
    //         'pick remote',
    //         'Pick a remote to push to:'
    //     );
    //     const choice = await window.showQuickPick<QuickPickItem>(picks, {
    //         placeHolder,
    //     });
    //     if (choice) {
    //         return choice.label;
    //     }

    //     return;
    // }

    export function warnUnresolvedFiles(unresolvedCount: number): void {
        const fileOrFiles =
            unresolvedCount === 1
                ? localize('file', 'file')
                : localize('files', 'files');
        window.showWarningMessage(
            localize(
                'unresolved files',
                'Merge leaves {0} {1} unresolved.',
                unresolvedCount,
                fileOrFiles
            )
        );
    }

    export function warnUnsavedChanges(msg: string): void {
        window.showWarningMessage(
            localize('unsaved changes', `Fossil: ${msg}`)
        );
    }

    export async function confirmUndoOrRedo(
        command: 'undo' | 'redo',
        command_text: FossilUndoCommand
    ): Promise<boolean> {
        const confirmText = command[0].toUpperCase() + command.slice(1);
        const message = localize(
            command,
            `${confirmText} '{0}'?`,
            command_text
        );
        const choice = await window.showInformationMessage(
            message,
            { modal: true },
            confirmText
        );
        return choice === confirmText;
    }

    export async function inputCommitMessage(
        message: string,
        defaultMessage?: string
    ): Promise<string | undefined> {
        if (message) {
            return message;
        }

        return window.showInputBox({
            value: defaultMessage,
            placeHolder: localize('commit message', 'Commit message'),
            prompt: localize(
                'provide commit message',
                'Please provide a commit message'
            ),
            ignoreFocusOut: true,
        });
    }

    export async function confirmDiscardAllChanges(
        this: void
    ): Promise<boolean> {
        const message = localize(
            'confirm discard all',
            'Are you sure you want to discard ALL changes?'
        );
        const discard = localize('discard', 'Discard Changes');
        const choice = await window.showWarningMessage(
            message,
            { modal: true },
            discard
        );
        return choice === discard;
    }

    export async function confirmDeleteExtras(this: void): Promise<boolean> {
        const message = localize(
            'confirm delete extras',
            'Are you sure you want to delete untracked and uningnored files?'
        );
        const discard = localize('discard', 'Delete Extras');
        const choice = await window.showWarningMessage(
            message,
            { modal: true },
            discard
        );
        return choice === discard;
    }

    export async function confirmDeleteResources(
        this: void,
        paths: string[]
    ): Promise<boolean> {
        let message: string;
        let yes: string;
        if (paths.length == 1) {
            message = localize(
                'confirm delete',
                'Are you sure you want to DELETE {0}?\nThis is IRREVERSIBLE!\nThis file will be FOREVER LOST if you proceed.',
                path.basename(paths[0])
            );
            yes = localize('delete file', 'Delete file');
        } else {
            message = localize(
                'confirm delete multiple',
                'Are you sure you want to DELETE {0} files?\nThis is IRREVERSIBLE!\nThese files will be FOREVER LOST if you proceed.',
                paths.length
            );
            yes = localize('delete files', 'Delete Files');
        }

        const choice = await window.showWarningMessage(
            message,
            { modal: true },
            yes
        );
        return choice === yes;
    }

    export async function confirmDiscardChanges(
        discardFilesnames: string[],
        addedFilenames: string[]
    ): Promise<boolean> {
        let addedMessage = '';
        if (addedFilenames.length > 0) {
            if (addedFilenames.length === 1) {
                addedMessage = localize(
                    'and forget',
                    "\n\n(and forget added file '{0}')",
                    path.basename(addedFilenames[0])
                );
            } else {
                addedMessage = localize(
                    'and forget multiple',
                    '\n\n(and forget {0} other added files)',
                    addedFilenames.length
                );
            }
        }

        let message: string;
        if (discardFilesnames.length === 1) {
            message = localize(
                'confirm discard',
                "Are you sure you want to discard changes to '{0}'?{1}",
                path.basename(discardFilesnames[0]),
                addedMessage
            );
        } else {
            const fileList =
                humanise.formatFilesAsBulletedList(discardFilesnames);
            message = localize(
                'confirm discard multiple',
                'Are you sure you want to discard changes to {0} files?\n\n{1}{2}',
                discardFilesnames.length,
                fileList,
                addedMessage
            );
        }

        const discard = localize('discard', 'Discard Changes');
        const choice = await window.showWarningMessage(
            message,
            { modal: true },
            discard
        );
        return choice === discard;
    }

    export async function confirmDeleteMissingFilesForCommit(
        filenames: string[]
    ): Promise<boolean> {
        let message: string;
        if (filenames.length === 1) {
            message = localize(
                'confirm delete missing',
                "Did you want to delete '{0}' in this commit?",
                path.basename(filenames[0])
            );
        } else {
            const fileList = humanise.formatFilesAsBulletedList(filenames);
            message = localize(
                'confirm delete missing multiple',
                'Did you want to delete {0} missing files in this commit?\n\n{1}',
                filenames.length,
                fileList
            );
        }

        const deleteOption = localize('delete', 'Delete');
        const choice = await window.showWarningMessage(
            message,
            { modal: true },
            deleteOption
        );
        return choice === deleteOption;
    }

    export async function confirmCommitWorkingGroup(): Promise<boolean> {
        const message = localize(
            'confirm commit working group',
            'There are no staged changes, do you want to commit working changes?\n'
        );
        const respOpt = localize('confirm', 'Confirm');
        const choice = await window.showWarningMessage(
            message,
            { modal: true },
            respOpt
        );
        return choice === respOpt;
    }

    export function errorUntrackedFilesDiffer(filenames: string[]): void {
        const fileList = humanise.formatFilesAsBulletedList(filenames);
        const message = localize(
            'untracked files differ',
            'Merge failed!\n\nUntracked files in your working directory would be overwritten by files of the same name from the merge revision:\n\n{0}\n\nEither track these files, move them, or delete them before merging.',
            fileList
        );
        window.showErrorMessage(message, { modal: true });
    }
}

abstract class RunnableQuickPickItem implements QuickPickItem {
    abstract get label(): string;
    abstract get description(): string;
    abstract run(): RunnableReturnType;
}

class TimelineEntryItem extends RunnableQuickPickItem {
    constructor(public commit: Commit) {
        super();
    }
    protected get age(): string {
        return humanise.ageFromNow(this.commit.date);
    }
    get label(): string {
        const hash = this.commit.hash.slice(0, SHORT_HASH_LENGTH);
        return `$(circle-outline) ${hash} ${BULLET} ${this.commit.branch}`;
    }
    get description(): string {
        return `$(person)${this.commit.author} $(calendar) ${this.age}`;
    }
    get detail(): string {
        return this.commit.message;
    }
    run() {
        // do nothing.
    }
}

class RunnableTimelineEntryItem extends TimelineEntryItem {
    constructor(commit: Commit, private action: RunnableAction) {
        super(commit);
    }
    run() {
        return this.action();
    }
}

abstract class UpdatingItem<T extends FossilCheckin> {
    constructor(public checkin: T) {}

    async run(repository: Repository): Promise<void> {
        await repository.update(this.checkin);
    }
}

class UpdateBranchItem
    extends UpdatingItem<FossilBranch>
    implements QuickPickItem
{
    get label(): string {
        return `$(git-branch) ${this.checkin}`;
    }
    get description(): string {
        return [
            ...(this.branch.isCurrent ? ['current'] : []),
            ...(this.branch.isPrivate ? ['private'] : []),
        ].join(', ');
    }
    constructor(private branch: BranchDetails) {
        super(branch.name);
    }
}

class UpdateTagItem extends UpdatingItem<FossilTag> implements QuickPickItem {
    get label(): string {
        return `$(tag) ${this.checkin}`;
    }
}

class FileStatusQuickPickItem extends RunnableQuickPickItem {
    get basename(): string {
        return path.basename(this.status.path);
    }
    get label(): string {
        return `${NBSP}${NBSP}${NBSP}${NBSP}${this.icon}${NBSP}${NBSP}${this.basename}`;
    }
    get description(): string {
        return path.dirname(this.status.path);
    }
    get icon(): string {
        switch (this.status.status) {
            case 'A':
                return 'Ａ'; //'$(diff-added)';
            case 'M':
                return 'Ｍ'; //'$(diff-modified)';
            case 'R':
                return 'Ｒ'; //'$(diff-removed)';
            default:
                return '';
        }
    }

    constructor(private status: IFileStatus, private action: RunnableAction) {
        super();
    }

    async run(): Promise<void> {
        return this.action();
    }
}

interface LogSourcePickItem extends QuickPickItem {
    options: LogEntryOptions;
    source: CommitSources;
}

/**
 * Simples possible `RunnableQuickPickItem`
 */
export class LiteralRunnableQuickPickItem extends RunnableQuickPickItem {
    constructor(
        public readonly label: string,
        public readonly description: string,
        public readonly detail: string,
        private _action: RunnableAction
    ) {
        super();
    }

    run(): RunnableReturnType {
        return this._action();
    }
}

type RunnableReturnType = Promise<any> | void;
export type RunnableAction = () => RunnableReturnType;
export interface LogMenuAPI {
    getBranchName: () => FossilBranch | undefined;
    getCommitDetails: (revision: FossilCheckin) => Promise<CommitDetails>;
    getLogEntries(options: LogEntriesOptions): Promise<Commit[]>;
    diffToParent: (file: IFileStatus, commit: CommitDetails) => any;
}
