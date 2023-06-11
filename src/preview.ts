import { FossilExecutable, FossilCWD } from './fossilExecutable';
import * as path from 'path';
import {
    Uri,
    window,
    workspace,
    ViewColumn,
    WebviewPanel,
    ExtensionContext,
    WebviewPanelSerializer,
    EventEmitter,
    WebviewOptions,
} from 'vscode';
import * as fs from 'fs/promises';
import { dispose, IDisposable } from './util';

type MDorWIKI = string & { __TYPE__: 'MDorWIKI' };
type RenderedHTML = string & { __TYPE__: 'RenderedHTML' };

const viewType = 'fossil.renderPanel';

export class FossilPreviewManager
    implements IDisposable, WebviewPanelSerializer
{
    private readonly previews: Set<FossilPreview>;
    private readonly mediaDir: Uri;
    private readonly _disposables: IDisposable[];
    private _activePreview: FossilPreview | undefined = undefined;

    constructor(
        context: ExtensionContext,
        private readonly executable: FossilExecutable
    ) {
        // super();
        this.previews = new Set();
        this.mediaDir = Uri.joinPath(context.extensionUri, 'media');
        this._disposables = [];
        this._register(window.registerWebviewPanelSerializer(viewType, this));
        // this._register(
        //     window.onDidChangeActiveTextEditor(editor => {
        //         console.log(`onDidChangeActiveTextEditor: ${editor}`);
        //     })
        // );
    }
    public dispose(): void {
        dispose(this.previews);
        dispose(this._disposables);
    }
    protected _register<T extends IDisposable>(value: T): T {
        this._disposables.push(value);
        return value;
    }
    public async deserializeWebviewPanel(
        panel: WebviewPanel,
        state: { uri: string }
    ): Promise<void> {
        const uri = Uri.parse(state.uri);
        const preview = new FossilPreview(
            panel,
            this.executable,
            uri,
            this.mediaDir
        );
        this.registerPreview(preview);
        // await preview.initializeFromUri(uri);
    }

    public getPreviewByPreviewUri(uri: Uri): FossilPreview | undefined {
        for (const pv of this.previews) {
            if (pv.uri == uri) {
                return pv;
            }
        }
        return undefined;
    }

    get activePreview(): FossilPreview | undefined {
        return this._activePreview;
    }

    public async openDynamicPreview(uri: Uri): Promise<void> {
        for (const pv of this.previews) {
            if (pv.uri.toString() == uri.toString()) {
                return pv.reveal();
            }
        }
        const preview = FossilPreview.create(
            this.executable,
            uri,
            this.mediaDir
        );
        this.registerPreview(preview);
        // await preview.initializeFromUri(uri);
    }

    private registerPreview(preview: FossilPreview): void {
        this._register(
            preview.panel.onDidChangeViewState(({ webviewPanel }) => {
                this._activePreview = webviewPanel.active ? preview : undefined;
            })
        );

        this._register(
            preview.onDispose(() => {
                this.previews.delete(preview);
                if (this._activePreview === preview) {
                    this._activePreview = undefined;
                }
            })
        );

        this.previews.add(preview);
    }
}

export class FossilPreview implements IDisposable {
    private renderer: 'wiki' | 'markdown' | undefined;
    private dirname!: FossilCWD;
    private readonly _disposables: IDisposable[] = [];
    private current_content: string | undefined;
    private next_content: string | undefined;
    private _callbacks: {
        resolve: (value: RenderedHTML) => void;
        reject: (reason: 'new request arrived') => void;
    }[] = [];

    private readonly _onDisposeEmitter = this._register(
        new EventEmitter<void>()
    );
    public readonly onDispose = this._onDisposeEmitter.event;

    // public currently_rendered_content?: string; // currently visible text before it was rendered

    public static create(
        executable: FossilExecutable,
        uri: Uri,
        mediaDir: Uri
    ): FossilPreview {
        const title = `Preview ${path.basename(uri.fsPath)}`;
        const panel = window.createWebviewPanel(
            viewType,
            title,
            ViewColumn.Beside,
            { retainContextWhenHidden: true }
        );
        return new FossilPreview(panel, executable, uri, mediaDir);
    }

    constructor(
        public readonly panel: WebviewPanel,
        private readonly executable: FossilExecutable,
        public uri: Uri,
        private readonly mediaDir: Uri
    ) {
        this.panel.onDidDispose(() => {
            this.dispose();
        });
        this._register(
            this.panel.webview.onDidReceiveMessage(
                (message: { status: 'loaded' }): void => {
                    if (message.status == 'loaded') {
                        this.getSource().then(source => {
                            if (source !== undefined) {
                                this.update(source);
                            }
                        });
                    }
                }
            )
        );

        this._register(
            workspace.onDidChangeTextDocument((event): void => {
                if (event.document.uri.path == this.uri.path) {
                    this.update(event.document.getText() as MDorWIKI);
                }
            })
        );
        this.initializeFromUri(uri);
        this.panel.webview.options = this.getWebviewOptions();
    }

    private async getSource(): Promise<MDorWIKI | undefined> {
        for (const document of workspace.textDocuments) {
            if (document.uri.path == this.uri.path) {
                return document.getText() as MDorWIKI;
            }
        }
        if (this.uri.scheme == 'file') {
            return (await fs.readFile(this.uri.fsPath, {
                encoding: 'utf-8',
            })) as MDorWIKI;
        }
        return;
    }

    private getWebviewOptions(): WebviewOptions {
        const dirname_uri = Uri.file(this.dirname);
        return {
            enableScripts: true,
            enableForms: false,
            localResourceRoots: [dirname_uri, this.mediaDir],
        };
    }

    protected _register<T extends IDisposable>(value: T): T {
        this._disposables.push(value);
        return value;
    }
    public dispose(): void {
        this._onDisposeEmitter.fire();
        // this._onDisposeEmitter.dispose();
        dispose(this._disposables);
        this._disposables.length = 0;
    }

    public reveal(): void {
        this.panel.reveal();
    }

    public async wikiCreate(
        where: 'Wiki' | 'Technote',
        title: string
    ): Promise<boolean> {
        const mimetype = (() => {
            switch (this.renderer) {
                case 'wiki':
                    return 'text/x-fossil-wiki';
                case 'markdown':
                    return 'text/x-markdown';
                default:
                    return 'text/plain';
            }
        })();
        const source = await this.getSource();
        if (source) {
            const res = await this.executable.exec(
                this.dirname,
                [
                    'wiki',
                    'create',
                    title,
                    '--mimetype',
                    mimetype,
                    ...(where == 'Technote' ? ['--technote', 'now'] : []),
                ],
                '',
                {
                    stdin_data: source,
                }
            );
            return res.exitCode == 0;
        } else {
            await window.showErrorMessage(
                'Unable to get wiki source\nplease report an issue on github'
            );
            return false;
        }
    }

    private async _run_current_task(
        renderer: 'wiki' | 'markdown'
    ): Promise<void> {
        while (this.current_content) {
            const awaiting_callback = this._callbacks;
            this._callbacks = [];
            const res = this.executable.exec(
                this.dirname,
                [`test-${renderer}-render`, '-'],
                '',
                { stdin_data: this.current_content }
            );
            // this.currently_rendered_content = this.current_content;
            const html = (await res).stdout as RenderedHTML;

            const current_item = awaiting_callback.pop();
            for (const cbs of awaiting_callback) {
                cbs.reject('new request arrived');
            }
            current_item!.resolve(html);
            this.current_content = this.next_content;
            this.next_content = undefined;
        }
    }

    /**
     * @param content: markdown/wiki string
     * @returns Promise with output of `fossil test-${this.renderer}-render`
     *          All old promises get rejected.
     */
    private async render(content: MDorWIKI): Promise<RenderedHTML> {
        const renderer = this.renderer;
        if (!renderer) {
            return `<h1>unknown fossil renderer</h1>` as RenderedHTML;
        }
        const ret = new Promise<RenderedHTML>((resolve, reject) => {
            this._callbacks.push({ resolve, reject });
        });
        if (this.current_content) {
            this.next_content = content;
        } else {
            this.current_content = content;
            if (!this.next_content) {
                this._run_current_task(renderer);
            }
        }
        return ret;
    }

    /**
     * render and post update message to the panel
     */
    private async update(content: MDorWIKI): Promise<void> {
        try {
            const rendered_html = await this.render(content);
            this.panel.webview.postMessage({
                html: rendered_html,
                uri: this.uri.toString(),
            });
        } catch (e) {
            if (e != 'new request arrived') {
                throw e;
            }
        }
    }

    private initializeFromUri(uri: Uri): void {
        if (uri.scheme == 'file') {
            this.dirname = path.dirname(uri.fsPath) as FossilCWD;
            this.renderer = (() => {
                switch (path.extname(uri.fsPath)) {
                    case '.wiki':
                        return 'wiki';
                    case '.md':
                        return 'markdown';
                }
                return;
            })();
        } else {
            // untitled schema - try our best
            const cwd = workspace.workspaceFolders?.[0].uri.fsPath ?? '.';
            this.dirname = cwd as FossilCWD;
            this.renderer = 'markdown';
        }
        this.uri = uri;
        const base_url = this.panel.webview.asWebviewUri(uri);
        const html = `<!DOCTYPE html><html>
  <head>
    <base href="${base_url}" />
    <script src="${this.extensionResourcePath('preview.js')}""></script>
    <link rel="stylesheet" type="text/css" href="${this.extensionResourcePath(
        'preview.css'
    )}">
  </head>
  <body class="vscode-body scrollBeyondLastLine">
    <div id="fossil-preview-content"></div>
  </body></html>`;
        this.panel.webview.html = html;
    }

    private extensionResourcePath(mediaFile: string): string {
        const webviewResource = this.panel.webview.asWebviewUri(
            Uri.joinPath(this.mediaDir, mediaFile)
        );
        return webviewResource.toString();
    }
}
