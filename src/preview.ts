import {
    FossilExecutable,
    FossilCWD,
    FossilArgs,
    Reason,
    FossilWikiTitle,
} from './fossilExecutable';
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
    ColorThemeKind,
    TextDocument,
    commands,
} from 'vscode';
import * as fs from 'fs/promises';
import { dispose, IDisposable } from './util';
import { inputSavePath } from './interaction';

type MDorWIKIorPIKCHR = string & { __TYPE__: 'MDorWIKIorPIKCHR' };
type RenderedHTML = string & { __TYPE__: 'RenderedHTML' };
type IsDark = boolean & { __TYPE__: 'IsDark' };

const viewType = 'fossil.renderPanel';

export class FossilPreviewManager
    implements IDisposable, WebviewPanelSerializer
{
    private readonly previews: Set<FossilPreview> = new Set();
    private readonly mediaDir: Uri;
    private readonly _disposables: IDisposable[] = [];
    private _activePreview: FossilPreview | undefined = undefined;

    constructor(
        context: ExtensionContext,
        private readonly executable: FossilExecutable
    ) {
        this.mediaDir = Uri.joinPath(context.extensionUri, 'media');
        this._register(window.registerWebviewPanelSerializer(viewType, this));
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
    }

    get activePreview(): FossilPreview | undefined {
        return this._activePreview;
    }

    public openDynamicPreview(uri: Uri): void {
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

function rendererFromUri(uri: Uri) {
    return (
        (
            {
                '.wiki': 'wiki',
                '.md': 'markdown',
                '.pikchr': 'pikchr',
            } as const
        )[path.extname(uri.fsPath)] ?? 'markdown'
    );
}

function rendererFromDocument(document: TextDocument | undefined) {
    if (!document) {
        return 'markdown';
    }
    const languageId = document.languageId;
    if (languageId == 'pikchr' || languageId == 'markdown') {
        return languageId;
    }
    if (languageId.includes('html')) {
        return 'wiki';
    }
    return rendererFromUri(document.uri);
}

class FossilPreview implements IDisposable {
    private renderer: 'wiki' | 'markdown' | 'pikchr' = 'markdown';
    private dirname!: FossilCWD;
    private readonly _disposables: IDisposable[] = [];
    private current_content: [MDorWIKIorPIKCHR, IsDark] | undefined;
    private next_content: [MDorWIKIorPIKCHR, IsDark] | undefined;
    private _callbacks: {
        resolve: (value: RenderedHTML) => void;
        reject: (reason: 'new request arrived') => void;
    }[] = [];
    private last_content: MDorWIKIorPIKCHR | undefined;
    /** fossil without dark/light mode support for pikchr */
    private readonly oldFossil: boolean;
    /** Rendered html to allow saving */
    private rendered_html: RenderedHTML | undefined;

    private readonly _onDisposeEmitter = this._register(
        new EventEmitter<void>()
    );
    public readonly onDispose = this._onDisposeEmitter.event;
    private closed = false;

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
        this.oldFossil = executable.version < [2, 24];

        this.panel.onDidDispose(() => {
            this.dispose();
        });
        if (!this.oldFossil) {
            this._register(
                window.onDidChangeActiveColorTheme(_ => this.update())
            );
        }
        this._register(
            this.panel.webview.onDidReceiveMessage(
                (message: { action: 'update' | 'save' }): void => {
                    if (message.action == 'update') {
                        this.getSource().then(source => {
                            if (source !== undefined) {
                                this.update(source);
                            }
                        });
                    }
                    if (message.action == 'save') {
                        commands.executeCommand('fossil.renderSave');
                    }
                }
            )
        );

        this._register(
            workspace.onDidChangeTextDocument((event): void => {
                if (event.document.uri.path == this.uri.path) {
                    this.renderer = rendererFromDocument(event.document);
                    this.update(event.document.getText() as MDorWIKIorPIKCHR);
                }
            })
        );
        this._register(
            // Listen for language id change, so that we can select
            // proper renderer
            workspace.onDidOpenTextDocument((document): void => {
                if (document.uri.path == this.uri.path) {
                    const renderer = rendererFromDocument(document);
                    if (renderer != this.renderer) {
                        this.renderer = renderer;
                        this.update();
                    }
                }
            })
        );
        this._register(
            workspace.onDidCloseTextDocument(document => {
                if (document.uri.path == this.uri.path) {
                    this.closed = true;
                }
            })
        );
        this._register(
            window.onDidChangeActiveTextEditor(editor => {
                // Only allow previewing normal text editors which have a viewColumn
                if (editor?.viewColumn === undefined) {
                    return;
                }
                if (
                    this.closed &&
                    ['markdown', 'pikchr', 'html'].includes(
                        editor.document.languageId
                    )
                ) {
                    this.closed = false;
                    this.uri = editor.document.uri;
                    this.panel.title = `Preview ${path.basename(uri.fsPath)}`;
                    this.getSource().then(source => {
                        if (source !== undefined) {
                            this.renderer = rendererFromDocument(
                                editor.document
                            );
                            this.update(source);
                        }
                    });
                }
            })
        );
        this.initializeFromUri(uri);
        this.panel.webview.options = this.getWebviewOptions();
    }

    private currentDocument(): TextDocument | undefined {
        for (const document of workspace.textDocuments) {
            if (document.uri.path == this.uri.path) {
                return document;
            }
        }
        return;
    }

    private async getSource(): Promise<MDorWIKIorPIKCHR | undefined> {
        const document = this.currentDocument();
        if (document) {
            return document.getText() as MDorWIKIorPIKCHR;
        }
        if (this.uri.scheme == 'file') {
            return fs.readFile(this.uri.fsPath, {
                encoding: 'utf-8',
            }) as Promise<MDorWIKIorPIKCHR>;
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
        dispose(this._disposables);
    }

    public reveal(): void {
        this.panel.reveal();
    }

    public async wikiCreate(
        where: 'Wiki' | 'Technote',
        title: FossilWikiTitle
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
                    ...(where == 'Technote'
                        ? (['--technote', 'now'] as const)
                        : ([] as const)),
                ],
                '' as Reason,
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

    public async save() {
        if (this.rendered_html) {
            const saveUri = await inputSavePath(this.uri, this.renderer);
            if (saveUri) {
                await fs.writeFile(saveUri.fsPath, this.rendered_html);
            }
        }
    }

    private async _run_current_task(
        renderer: 'wiki' | 'markdown' | 'pikchr'
    ): Promise<void> {
        while (this.current_content) {
            const awaiting_callback = this._callbacks;
            this._callbacks = [];
            const dark = this.current_content[1] && !this.oldFossil;
            let args: FossilArgs;
            if (renderer == 'pikchr') {
                args = [
                    'pikchr',
                    ...(dark ? (['-dark'] as const) : ([] as const)),
                ];
            } else {
                args = [
                    `test-${renderer}-render`,
                    ...(dark ? (['--dark-pikchr'] as const) : ([] as const)),
                    '-',
                ];
            }

            const result = await this.executable.exec(
                this.dirname,
                args,
                'preview' as Reason,
                {
                    stdin_data: this.current_content[0],
                    logErrors: false,
                }
            );
            let html: RenderedHTML;
            if (!result.exitCode) {
                html = result.stdout as RenderedHTML;
            } else {
                html = `<pre>${result.stderr}</pre>` as RenderedHTML;
            }

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
    private async render(
        content: MDorWIKIorPIKCHR,
        isDark: IsDark
    ): Promise<RenderedHTML> {
        const ret = new Promise<RenderedHTML>((resolve, reject) => {
            this._callbacks.push({ resolve, reject });
        });
        if (this.current_content) {
            this.next_content = [content, isDark];
        } else {
            this.current_content = [content, isDark];
            if (!this.next_content) {
                this._run_current_task(this.renderer);
            }
        }
        return ret;
    }

    /**
     * render and post update message to the panel
     */
    private async update(content?: MDorWIKIorPIKCHR): Promise<void> {
        try {
            content ??= this.last_content;
            this.last_content = content;
            if (content === undefined) {
                return;
            }
            const kind = window.activeColorTheme.kind;
            this.rendered_html = await this.render(
                content,
                (kind === ColorThemeKind.Dark ||
                    kind === ColorThemeKind.HighContrast) as IsDark
            );
            await this.panel.webview.postMessage({
                html: this.rendered_html,
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
            this.renderer = rendererFromUri(uri);
        } else {
            // untitled schema - try our best
            const cwd = workspace.workspaceFolders?.[0].uri.fsPath ?? '.';
            this.dirname = cwd as FossilCWD;
            this.renderer = rendererFromDocument(this.currentDocument());
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
  <body class="vscode-body scrollBeyondLastLine${
      this.oldFossil ? ' oldFossil' : ''
  }">
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
