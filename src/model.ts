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
} from 'vscode';
import { Fossil, FossilError } from './fossilBase';
import { anyEvent, filterEvent, dispose } from './util';
import { memoize, debounce, sequentialize } from './decorators';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as nls from 'vscode-nls';
import typedConfig from './config';
import { Repository, RepositoryState } from './repository';

const localize = nls.loadMessageBundle();

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
    repository: Repository;
    uri: Uri;
}

export interface OriginalResourceChangeEvent {
    repository: Repository;
    uri: Uri;
}

interface OpenRepository extends Disposable {
    repository: Repository;
}

function isParent(parent: string, child: string): boolean {
    return child.startsWith(parent);
}

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

    private openRepositories: OpenRepository[] = [];
    get repositories(): Repository[] {
        return this.openRepositories.map(r => r.repository);
    }

    private possibleHgRepositoryPaths = new Set<string>();

    private enabled = false;
    private configurationChangeDisposable: Disposable;
    private readonly disposables: Disposable[] = [];

    constructor(private _hg: Fossil) {
        this.enabled = typedConfig.enabled;
        this.configurationChangeDisposable = workspace.onDidChangeConfiguration(
            this.onDidChangeConfiguration,
            this
        );

        if (this.enabled) {
            this.enable();
        }
    }

    private onDidChangeConfiguration(): void {
        const enabled = typedConfig.enabled;

        if (enabled === this.enabled) {
            return;
        }

        this.enabled = enabled;

        if (enabled) {
            this.enable();
        } else {
            this.disable();
        }
    }

    private enable(): void {
        workspace.onDidChangeWorkspaceFolders(
            this.onDidChangeWorkspaceFolders,
            this,
            this.disposables
        );
        this.onDidChangeWorkspaceFolders({
            added: workspace.workspaceFolders || [],
            removed: [],
        });

        window.onDidChangeVisibleTextEditors(
            this.onDidChangeVisibleTextEditors,
            this,
            this.disposables
        );
        this.onDidChangeVisibleTextEditors(window.visibleTextEditors);

        const fsWatcher = workspace.createFileSystemWatcher('**');
        this.disposables.push(fsWatcher);

        const onWorkspaceChange = anyEvent(
            fsWatcher.onDidChange,
            fsWatcher.onDidCreate,
            fsWatcher.onDidDelete
        );
        onWorkspaceChange(
            this.onPossibleHgRepositoryChange,
            this,
            this.disposables
        );

        this.scanWorkspaceFolders();
        // this.status();
    }

    private disable(): void {
        const openRepositories = [...this.openRepositories];
        openRepositories.forEach(r => r.dispose());
        this.openRepositories = [];

        this.possibleHgRepositoryPaths.clear();
        dispose(this.disposables);
    }

    /**
     * Scans the first level of each workspace folder, looking
     * for fossil repositories.
     */
    private async scanWorkspaceFolders(): Promise<void> {
        for (const folder of workspace.workspaceFolders || []) {
            const root = folder.uri.fsPath;
            const children = await fs.readdir(root, { withFileTypes: true });
            children
                .filter(child => child.isDirectory())
                .some(child => this.tryOpenRepository(child.name));
        }
    }

    private onPossibleHgRepositoryChange(uri: Uri): void {
        const possibleHgRepositoryPath = uri.fsPath.replace(/\.hg.*$/, '');
        this.possibleHgRepositoryPaths.add(possibleHgRepositoryPath);
        this.eventuallyScanPossibleHgRepositories();
    }

    @debounce(500)
    private eventuallyScanPossibleHgRepositories(): void {
        for (const path of this.possibleHgRepositoryPaths) {
            this.tryOpenRepository(path);
        }

        this.possibleHgRepositoryPaths.clear();
    }

    private async onDidChangeWorkspaceFolders({
        added,
        removed,
    }: WorkspaceFoldersChangeEvent): Promise<void> {
        const possibleRepositoryFolders = added.filter(
            folder => !this.getOpenRepository(folder.uri)
        );

        const activeRepositoriesList = window.visibleTextEditors
            .map(editor => this.getRepository(editor.document.uri))
            .filter(repository => !!repository) as Repository[];

        const activeRepositories = new Set<Repository>(activeRepositoriesList);
        const openRepositoriesToDispose = removed
            .map(folder => this.getOpenRepository(folder.uri))
            .filter(r => !!r)
            .filter(r => !activeRepositories.has(r!.repository))
            .filter(
                r =>
                    !(workspace.workspaceFolders || []).some(f =>
                        isParent(f.uri.fsPath, r!.repository.root)
                    )
            ) as OpenRepository[];

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

        try {
            const repositoryRoot = await this._hg.getRepositoryRoot(path);

            // This can happen whenever `path` has the wrong case sensitivity in
            // case insensitive file systems
            // https://github.com/Microsoft/vscode/issues/33498

            if (this.getRepository(Uri.file(repositoryRoot))) {
                return true;
            }

            const repository = new Repository(this._hg.open(repositoryRoot));

            this.open(repository);
            return true;
        } catch (err) {
            if (
                !(err instanceof FossilError) ||
                err.fossilErrorCode !== 'NotAFossilRepository'
            ) {
                console.error('Failed to find repository:', err);
            }
        }
        return false;
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

        return pick && pick.repository;
    }

    getOpenRepositories(): Repository[] {
        return this.openRepositories.map(r => r.repository);
    }

    getRepository(
        hint: Uri | SourceControl | Repository
    ): Repository | undefined {
        const liveRepository = this.getOpenRepository(hint);
        return liveRepository && liveRepository.repository;
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
        this.configurationChangeDisposable.dispose();
    }
}
