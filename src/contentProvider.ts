/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ben Crowl. All rights reserved.
 *  Original Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    workspace,
    Uri,
    Disposable,
    Event,
    EventEmitter,
    window,
    TextDocumentContentProvider,
} from 'vscode';
import { debounce, throttle } from './decorators';
import { Model, OriginalResourceChangeEvent } from './model';
import { filterEvent, eventToPromise } from './util';
import { fromFossilUri, toFossilUri } from './uri';

interface CacheRow {
    uri: Uri;
    timestamp: number;
}

interface Cache {
    [uri: string]: CacheRow;
}

const THREE_MINUTES = 1000 * 60 * 3;
const FIVE_MINUTES = 1000 * 60 * 5;

export class FossilContentProvider implements TextDocumentContentProvider {
    private _onDidChange = new EventEmitter<Uri>();
    get onDidChange(): Event<Uri> {
        return this._onDidChange.event;
    }

    private changedRepositoryRoots = new Set<string>();
    private cache: Cache = Object.create(null);
    private disposables: Disposable[] = [];

    constructor(private model: Model) {
        this.disposables.push(
            model.onDidChangeRepository(this.eventuallyFireChangeEvents, this),
            model.onDidChangeOriginalResource(
                this.onDidChangeOriginalResource,
                this
            ),
            workspace.registerTextDocumentContentProvider('fossil', this)
        );

        setInterval(() => this.cleanup(), FIVE_MINUTES);
    }

    private onDidChangeOriginalResource({
        uri,
    }: OriginalResourceChangeEvent): void {
        if (uri.scheme !== 'file') {
            return;
        }

        this._onDidChange.fire(toFossilUri(uri));
    }

    @debounce(1100)
    private eventuallyFireChangeEvents(): void {
        this.fireChangeEvents();
    }

    @throttle
    private async fireChangeEvents(): Promise<void> {
        if (!window.state.focused) {
            const onDidFocusWindow = filterEvent(
                window.onDidChangeWindowState,
                e => e.focused
            );
            await eventToPromise(onDidFocusWindow);
        }

        Object.keys(this.cache).forEach(key => {
            const uri = this.cache[key].uri;
            // const fsPath = uri.fsPath;

            this._onDidChange.fire(uri);

            // for (const root of this.changedRepositoryRoots) {
            //     if (fsPath.startsWith(root)) {
            //         this._onDidChange.fire(uri);
            //         return;
            //     }
            // }
        });

        this.changedRepositoryRoots.clear();

        // await this.model.whenIdle();

        // Object.keys(this.cache).forEach(key => this.onDidChangeEmitter.fire(this.cache[key].uri));
    }

    async provideTextDocumentContent(uri: Uri): Promise<string> {
        const repository = this.model.getRepository(uri);

        if (!repository || uri.query == 'empty') {
            return '';
        }

        const cacheKey = uri.toString();
        const timestamp = new Date().getTime();
        const cacheValue = { uri, timestamp };

        this.cache[cacheKey] = cacheValue;

        const params = fromFossilUri(uri);

        try {
            return repository.show(params);
        } catch (err) {
            // no-op
        }

        return '';
    }

    private cleanup(): void {
        const now = new Date().getTime();
        const cache = Object.create(null);

        Object.keys(this.cache).forEach(key => {
            const row = this.cache[key];
            const isOpen = window.visibleTextEditors.some(
                e => e.document.uri.fsPath === row.uri.fsPath
            );

            if (isOpen || now - row.timestamp < THREE_MINUTES) {
                cache[row.uri.toString()] = row;
            }
        });

        this.cache = cache;
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
    }
}
