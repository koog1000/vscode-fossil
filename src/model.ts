/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ben Crowl. All rights reserved.
 *  Original Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Uri,
    EventEmitter,
    Event,
    Disposable,
    window,
    workspace,
    SourceControl,
    WorkspaceFoldersChangeEvent,
    TextEditor,
    QuickPickItem,
    FileRenameEvent,
    commands,
    ConfigurationChangeEvent,
} from 'vscode';
import type { FossilExecutable, Reason } from './fossilExecutable';
import { anyEvent, filterEvent, dispose, eventToPromise } from './util';
import { memoize, debounce, sequentialize } from './decorators';
import * as path from 'path';
import * as fs from 'fs/promises';
import typedConfig from './config';
import { Repository, RepositoryState } from './repository';

import { localize } from './main';
import * as interaction from './interaction';
import { OpenedRepository } from './openedRepository';
import {
    FossilExecutableInfo,
    UnvalidatedFossilExecutablePath,
    findFossil,
} from './fossilFinder';

class RepositoryPick implements QuickPickItem {
    @memoize get label(): string {
        return path.basename(this.repository.root);
    }

    get description(): string {
        return '';
    }
    // @memoize get description(): string {
    // return [this.repository.currentBranch, this.repository.syncLabel]
    //  .filter(l => !!l)
    //  .join(' ');
    // }

    constructor(public readonly repository: Repository) {}
}

export interface ModelChangeEvent {
    readonly repository: Repository;
    readonly uri: Uri;
}

export interface OriginalResourceChangeEvent {
    readonly repository: Repository;
    readonly uri: Uri;
}

interface OpenRepository extends Disposable {
    readonly repository: Repository;
}

function isParent(parent: string, child: string): boolean {
    return child.startsWith(parent);
}

const enum State {
    UNINITIALIZED = 1,
    INITIALIZED,
}

/**
 *
 * 1) Model should manage list of Repository objects
 *    in vscode's source control panel
 * 2) Model is exposed as fossil Extension API
 */
export class Model implements Disposable {
    private _onDidOpenRepository = new EventEmitter<Repository>();
    readonly onDidOpenRepository: Event<Repository> =
        this._onDidOpenRepository.event;

    private _onDidCloseRepository = new EventEmitter<Repository>();
    readonly onDidCloseRepository: Event<Repository> =
        this._onDidCloseRepository.event;

    private _onDidChangeRepository = new EventEmitter<ModelChangeEvent>();
    readonly onDidChangeRepository: Event<ModelChangeEvent> =
        this._onDidChangeRepository.event;

    private _onDidChangeOriginalResource =
        new EventEmitter<OriginalResourceChangeEvent>();
    readonly onDidChangeOriginalResource: Event<OriginalResourceChangeEvent> =
        this._onDidChangeOriginalResource.event;

    private _onDidChangeState = new EventEmitter<State>();
    readonly onDidChangeState = this._onDidChangeState.event;

    private openRepositories: OpenRepository[] = [];
    get repositories(): Repository[] {
        return this.openRepositories.map(r => r.repository);
    }

    private possibleFossilRepositoryPaths = new Set<string>();

    private _state = State.UNINITIALIZED;
    get state(): State {
        return this._state;
    }

    set state(state: State) {
        this._state = state;

        this._onDidChangeState.fire(state);
    }

    private readonly disposables: Disposable[] = [];
    // event for when `fossil.found` is set
    private readonly subscriptions: Disposable[] = [];
    private renamingDisposable: Disposable | undefined;

    /**
     * @param executable executable that will be initialized later
     * @param lastUsedHist used when configuration updates
     */
    constructor(
        private readonly executable: FossilExecutable,
        private lastUsedHist: UnvalidatedFossilExecutablePath | null
    ) {
        workspace.onDidChangeConfiguration(
            this.onDidChangeConfiguration,
            this,
            this.disposables
        );

        this.onDidChangeConfiguration();
    }

    @memoize
    get isInitialized(): Promise<void> {
        if (this._state === State.INITIALIZED) {
            return Promise.resolve();
        }

        return eventToPromise(
            filterEvent(this.onDidChangeState, s => s === State.INITIALIZED)
        ) as Promise<any>;
    }

    /**
     *
     * @returns Promise that is used in extension tests only
     */
    private onDidChangeConfiguration(
        event?: ConfigurationChangeEvent
    ): Promise<void> | void {
        if (event && !event.affectsConfiguration('fossil')) {
            return;
        }
        this.renamingDisposable?.dispose();
        if (typedConfig.enableRenaming) {
            this.renamingDisposable = workspace.onDidRenameFiles(
                this.onDidRenameFiles,
                this,
                this.disposables
            );
        }
        const fossilHint = typedConfig.path;
        if (this.lastUsedHist != fossilHint) {
            this.lastUsedHist = fossilHint;
            return findFossil(fossilHint, this.executable.outputChannel).then(
                this.foundExecutable.bind(this)
            );
        }
        if (!event || event.affectsConfiguration('fossil.autoSyncInterval')) {
            for (const repository of this.repositories) {
                repository.updateAutoSyncInterval(
                    typedConfig.autoSyncIntervalMs
                );
            }
        }
    }

    public async foundExecutable(
        info: FossilExecutableInfo | undefined
    ): Promise<void> {
        await commands.executeCommand('setContext', 'fossil.found', !!info);
        dispose(this.subscriptions);
        if (info) {
            await this.subscribe();
            try {
                this.executable.setInfo(info);
                await this.doInitialScan();
            } finally {
                this._state = State.INITIALIZED;
            }
        }
    }

    private async subscribe() {
        const subscribe = <T extends Disposable>(d: T) => (
            this.subscriptions.push(d), d
        );
        subscribe(
            workspace.onDidChangeWorkspaceFolders(
                this.onDidChangeWorkspaceFolders,
                this,
                this.disposables
            )
        );

        subscribe(
            window.onDidChangeVisibleTextEditors(
                this.onDidChangeVisibleTextEditors,
                this,
                this.disposables
            )
        );

        const checkoutWatcher = subscribe(
            workspace.createFileSystemWatcher('**/.fslckout')
        );

        const onWorkspaceChange = anyEvent(
            checkoutWatcher.onDidChange,
            checkoutWatcher.onDidCreate,
            checkoutWatcher.onDidDelete
        );
        subscribe(
            onWorkspaceChange(
                this.onPossibleFossilRepositoryChange,
                this,
                this.disposables
            )
        );
    }

    private async doInitialScan(): Promise<void> {
        await Promise.all([
            this.onDidChangeWorkspaceFolders({
                added: workspace.workspaceFolders || [],
                removed: [],
            }),
            this.onDidChangeVisibleTextEditors(window.visibleTextEditors),
            this.scanWorkspaceFolders(),
        ]);
    }

    private disable(): void {
        const openRepositories = [...this.openRepositories];
        dispose(openRepositories);
        this.possibleFossilRepositoryPaths.clear();
        dispose(this.disposables);
        dispose(this.subscriptions);
    }

    /**
     * Scans the first level of each workspace folder, looking
     * for fossil repositories.
     */
    private async scanWorkspaceFolders(): Promise<void> {
        for (const folder of workspace.workspaceFolders || []) {
            const root = folder.uri.fsPath;
            const children = await fs.readdir(root, { withFileTypes: true });
            for (const child of children) {
                if (child.isDirectory()) {
                    await this.tryOpenRepository(
                        Uri.joinPath(folder.uri, child.name).fsPath
                    );
                }
            }
        }
    }

    private onPossibleFossilRepositoryChange(uri: Uri): void {
        this.possibleFossilRepositoryPaths.add(
            uri.fsPath.replace('.fslckout', '')
        );
        this.eventuallyScanPossibleFossilRepositories();
    }

    @debounce(500)
    private eventuallyScanPossibleFossilRepositories(): void {
        for (const path of this.possibleFossilRepositoryPaths) {
            this.tryOpenRepository(path);
        }

        this.possibleFossilRepositoryPaths.clear();
    }

    // An event that is emitted when a workspace folder is added or removed.
    private async onDidChangeWorkspaceFolders({
        added,
        removed,
    }: WorkspaceFoldersChangeEvent): Promise<void> {
        const possibleRepositoryFolders = added.filter(
            folder => !this.getOpenRepository(folder.uri)
        );

        const activeRepositoriesList = window.visibleTextEditors
            .map(editor => this.getRepository(editor.document.uri))
            .filter(Boolean);

        const activeRepositories = new Set<Repository>(activeRepositoriesList);
        const openRepositoriesToDispose = removed
            .map(folder => this.getOpenRepository(folder.uri))
            .filter(Boolean)
            .filter(r => !activeRepositories.has(r.repository))
            .filter(
                r =>
                    !(workspace.workspaceFolders || []).some(f =>
                        isParent(f.uri.fsPath, r.repository.root)
                    )
            );

        possibleRepositoryFolders.forEach(p =>
            this.tryOpenRepository(p.uri.fsPath)
        );
        openRepositoriesToDispose.forEach(r => r.dispose());
    }

    private onDidChangeVisibleTextEditors(
        editors: readonly TextEditor[]
    ): void {
        editors.forEach(editor => {
            const uri = editor.document.uri;

            if (uri.scheme !== 'file') {
                return;
            }

            const repository = this.getRepository(uri);

            if (repository) {
                return;
            }

            this.tryOpenRepository(path.dirname(uri.fsPath));
        });
    }

    async onDidRenameFiles(e: FileRenameEvent): Promise<void> {
        for (const { oldUri, newUri } of e.files) {
            const repository = this.getRepository(oldUri);
            if (repository) {
                await repository.updateStatus('file rename event' as Reason);
                if (
                    repository.isInAnyGroup(oldUri) ||
                    repository.isDirInAnyGroup(oldUri)
                ) {
                    const oldPath =
                        repository.mapFileUriToRepoRelativePath(oldUri);
                    const newPath =
                        repository.mapFileUriToRepoRelativePath(newUri);

                    if (await interaction.confirmRename(oldPath, newPath)) {
                        return repository.rename(oldPath, newPath);
                    }
                }
            }
        }
    }

    /**
     *
     * @param path path to any file or directory in an opened repo
     * @returns stop trying to open the repo
     */
    @sequentialize
    async tryOpenRepository(path: string): Promise<boolean> {
        if (this.getRepository(Uri.file(path))) {
            return true;
        }

        const openedRepository = await OpenedRepository.tryOpen(
            this.executable,
            path
        );
        if (!openedRepository) {
            return false;
        }

        // This can happen whenever `path` has the wrong case sensitivity in
        // case insensitive file systems
        // https://github.com/Microsoft/vscode/issues/33498
        // the above comment is here from git extension and
        // might not be relevant for fossil

        if (this.getRepository(Uri.file(openedRepository.root))) {
            return true;
        }

        const repository = new Repository(openedRepository);

        this.open(repository);
        return true;
    }

    private open(repository: Repository): void {
        const onDidDisappearRepository = filterEvent(
            repository.onDidChangeState,
            state => state === RepositoryState.Disposed
        );
        const disappearListener = onDidDisappearRepository(() => dispose());
        const changeListener = repository.onDidChangeRepository(uri =>
            this._onDidChangeRepository.fire({ repository, uri })
        );
        const originalResourceChangeListener =
            repository.onDidChangeOriginalResource(uri =>
                this._onDidChangeOriginalResource.fire({ repository, uri })
            );

        const dispose = () => {
            disappearListener.dispose();
            changeListener.dispose();
            originalResourceChangeListener.dispose();
            repository.dispose();

            this.openRepositories = this.openRepositories.filter(
                e => e !== openRepository
            );
            this._onDidCloseRepository.fire(repository);
        };

        const openRepository = { repository, dispose };
        this.openRepositories.push(openRepository);
        this._onDidOpenRepository.fire(repository);
    }

    async close(repository: Repository): Promise<void> {
        const openRepository = this.getOpenRepository(repository);
        if (!openRepository) {
            return;
        }
        if (await openRepository.repository.close()) {
            openRepository.dispose();
        }
    }

    async pickRepository(): Promise<Repository | undefined> {
        if (this.openRepositories.length === 0) {
            throw new Error(
                localize(
                    'no repositories',
                    'There are no available repositories'
                )
            );
        }

        const picks = this.openRepositories.map(
            e => new RepositoryPick(e.repository)
        );
        const placeHolder = localize('pick repo', 'Choose a repository');
        const pick = await window.showQuickPick(picks, { placeHolder });

        return pick?.repository;
    }

    getOpenRepositories(): Repository[] {
        return this.openRepositories.map(r => r.repository);
    }

    getRepository(
        hint: Uri | SourceControl | Repository
    ): Repository | undefined {
        return this.getOpenRepository(hint)?.repository;
    }

    private getOpenRepository(
        hint: Uri | SourceControl | Repository
    ): OpenRepository | undefined {
        if (!hint) {
            return undefined;
        }

        if (hint instanceof Repository) {
            return this.openRepositories.filter(r => r.repository === hint)[0];
        }

        if (hint instanceof Uri) {
            const resourcePath = hint.fsPath;

            for (const liveRepository of this.openRepositories) {
                const relativePath = path.relative(
                    liveRepository.repository.root,
                    resourcePath
                );

                if (!/^\.\./.test(relativePath)) {
                    return liveRepository;
                }
            }

            return undefined;
        }

        for (const liveRepository of this.openRepositories) {
            const repository = liveRepository.repository;

            if (hint === repository.sourceControl) {
                return liveRepository;
            }
        }

        return undefined;
    }

    dispose(): void {
        this.disable();
        this.renamingDisposable?.dispose();
    }
}
