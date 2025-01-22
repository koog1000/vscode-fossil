import { Suite, test } from 'mocha';
import { commands, window, workspace, Uri } from 'vscode';
import * as assert from 'assert/strict';
import * as fs from 'fs/promises';
import * as vscode from 'vscode';
import type { languages } from 'vscode';
import * as sinon from 'sinon';
import { add, getRepository } from './common';
import type {
    FossilCommitMessage,
    FossilUsername,
    OpenedRepository,
    RelativePath,
} from '../../openedRepository';
import type { LineChange } from '../../revert';
import { delay } from '../../util';

function PraiseSuite(this: Suite) {
    test('Praise nothing', async () => {
        assert.ok(!window.activeTextEditor);
        await commands.executeCommand('fossil.praise');
    });

    suite('Praise file', () => {
        let registerHoverProviderSpy: sinon.SinonSpy<
            Parameters<typeof languages.registerHoverProvider>
        >;
        let onDidChangeTextDocumentSpy: sinon.SinonSpy<
            Parameters<typeof workspace.onDidChangeTextDocument>
        >;
        let onDidCloseTextDocumentSpy: sinon.SinonSpy<
            Parameters<typeof workspace.onDidCloseTextDocument>
        >;
        let onDidChangeTextEditorSelectionSpy: sinon.SinonSpy<
            Parameters<typeof window.onDidChangeTextEditorSelection>
        >;

        test('First time', async () => {
            const uri = Uri.joinPath(
                workspace.workspaceFolders![0].uri,
                'praise.txt'
            );
            const path = uri.fsPath;
            await fs.writeFile(path, [...'first', ''].join('\n'));
            const repository = getRepository();
            const openedRepository: OpenedRepository = (repository as any)
                .repository;
            const ci = (n: number) =>
                openedRepository.exec([
                    'commit',
                    '--user-override',
                    `u${n}` as FossilUsername,
                    path as RelativePath,
                    '-m',
                    `praise ${n}` as FossilCommitMessage,
                ]);
            await openedRepository.exec(['add', path as RelativePath]);
            await ci(1);
            await fs.appendFile(path, [...'second', ''].join('\n'));
            await ci(2);
            await fs.appendFile(path, [...'third', ''].join('\n'));
            await ci(3);
            await fs.appendFile(path, [...'user', ''].join('\n'));

            await commands.executeCommand('vscode.open', vscode.Uri.file(path));
            assert.ok(window.activeTextEditor);
            assert.equal(
                window.activeTextEditor.document.uri.fsPath,
                uri.fsPath
            );

            onDidChangeTextDocumentSpy = this.ctx.sandbox.spy(
                vscode.workspace,
                'onDidChangeTextDocument'
            );
            onDidCloseTextDocumentSpy = this.ctx.sandbox.spy(
                vscode.workspace,
                'onDidCloseTextDocument'
            );
            registerHoverProviderSpy = this.ctx.sandbox.spy(
                vscode.languages,
                'registerHoverProvider'
            );
            onDidChangeTextEditorSelectionSpy = this.ctx.sandbox.spy(
                vscode.window,
                'onDidChangeTextEditorSelection'
            );

            await commands.executeCommand('fossil.praise');
            sinon.assert.calledOnce(registerHoverProviderSpy);
            sinon.assert.calledOnce(onDidChangeTextDocumentSpy);
            sinon.assert.calledOnce(onDidCloseTextDocumentSpy);
            sinon.assert.calledOnce(onDidChangeTextEditorSelectionSpy);
        }).timeout(30000); // sometimes io is unpredictable

        test('Second time', async () => {
            const registerHoverProviderSpy = this.ctx.sandbox.spy(
                vscode.languages,
                'registerHoverProvider'
            );
            await commands.executeCommand('fossil.praise');
            sinon.assert.notCalled(registerHoverProviderSpy);
        });

        test('Hover full text', async () => {
            assert.ok(window.activeTextEditor);
            const hover =
                await registerHoverProviderSpy.firstCall.args[1].provideHover(
                    window.activeTextEditor.document,
                    new vscode.Position(1, 1),
                    null as any
                );
            assert.ok(hover);
            assert.ok(hover.contents[0] instanceof vscode.MarkdownString);
            assert.match(
                hover.contents[0].value,
                /^\*\*praise 1 \(user: u1\)\*\*\n\n\* hash: \*\*.*\*\*\n\* parent: \*\*.*\n\* child: \*\*.*\*\*\n\* tags: \*\*trunk\*\*\n$/
            );
        });

        test('Hover for another document', async () => {
            assert.ok(window.activeTextEditor);
            const hover =
                await registerHoverProviderSpy.firstCall.args[1].provideHover(
                    null as any,
                    null as any,
                    null as any
                );
            assert.strictEqual(hover, undefined);
        });

        test('Hover user line', async () => {
            assert.ok(window.activeTextEditor);
            const hover =
                await registerHoverProviderSpy.firstCall.args[1].provideHover(
                    window.activeTextEditor.document,
                    new vscode.Position(100, 1),
                    null as any
                );
            assert.ok(hover);
            assert.ok(hover.contents[0] instanceof vscode.MarkdownString);
            assert.equal(hover.contents[0].value, 'local change');
        });

        test('Close text document event', async () => {
            const args = onDidCloseTextDocumentSpy.firstCall.args;
            const close = args[0].bind(args[1]);
            close({} as vscode.TextDocument);
            assert.ok(window.activeTextEditor);
            close(window.activeTextEditor.document);
        });

        test('Change text document event', async () => {
            const args = onDidChangeTextDocumentSpy.firstCall.args;
            const change = args[0].bind(args[1]);
            change({
                document: {} as vscode.TextDocument,
                contentChanges: [],
                reason: undefined,
            });
            assert.ok(window.activeTextEditor);
            change({
                document: window.activeTextEditor.document,
                contentChanges: [],
                reason: undefined,
            });
        });

        test('Change text document event', async () => {
            const args = onDidChangeTextEditorSelectionSpy.firstCall.args;
            const change = args[0].bind(args[1]);
            change({
                kind: undefined as any,
                selections: [],
                textEditor: undefined as any,
            });
            assert.ok(window.activeTextEditor);
            // setDecorations cannot be watched, so this is a code coverage test
            change({
                kind: undefined as any,
                selections: [
                    new vscode.Selection(
                        new vscode.Position(1, 1),
                        new vscode.Position(1, 1)
                    ),
                ],
                textEditor: window.activeTextEditor,
            });
        });
    });
}

function RenderSuite(this: Suite) {
    let panel: vscode.WebviewPanel | undefined;
    this.afterAll(() => {
        assert.ok(panel);
        panel.dispose();
    });

    const createAndTestPanel = async () => {
        const untitledDocument = await workspace.openTextDocument();
        const editor = await window.showTextDocument(untitledDocument);
        await editor.edit(te =>
            te.insert(new vscode.Position(0, 0), '# test\n\n1. a\n1. b')
        );
        await commands.executeCommand('vscode.open', untitledDocument.uri);
        assert.equal(window.activeTextEditor, editor);
        const cwp = this.ctx.sandbox
            .stub(window, 'createWebviewPanel')
            .callThrough();
        await commands.executeCommand('fossil.render', untitledDocument.uri);
        sinon.assert.calledOnce(cwp);
        const panel = cwp.firstCall.returnValue;
        const postMessageStub = this.ctx.sandbox
            .stub(panel.webview, 'postMessage')
            .callThrough();
        const postedMessage = await new Promise<any>(c => {
            postMessageStub
                .onFirstCall()
                .callsFake((message: any): Thenable<boolean> => {
                    const ret = postMessageStub.wrappedMethod.call(
                        panel.webview,
                        message
                    );
                    c(message);
                    return ret;
                });
        });
        sinon.assert.match(postedMessage, {
            html: sinon.match.string,
            uri: sinon.match.string,
        });
        return panel;
    };
    test('Render', async () => {
        panel = await createAndTestPanel();
    }).timeout(9000);

    test('Create Technote', async () => {
        /* c8 ignore next 3 */
        if (!panel) {
            panel = await createAndTestPanel();
        }
        const showQuickPick = this.ctx.sandbox.stub(window, 'showQuickPick');
        showQuickPick.onFirstCall().callsFake(items => {
            assert.ok(items instanceof Array);
            assert.equal(items[0], 'Technote');
            return Promise.resolve(items[0]);
        });
        const commentStub = this.ctx.sandbox
            .stub(window, 'showInputBox')
            .withArgs(
                sinon.match({ prompt: 'Timeline comment of the technote' })
            )
            .resolves('technote comment');

        const sim: sinon.SinonStub = this.ctx.sandbox
            .stub(window, 'showInformationMessage')
            .resolves();
        await commands.executeCommand('fossil.wikiCreate');
        sinon.assert.calledOnce(commentStub);
        sinon.assert.calledOnceWithExactly(
            sim,
            'Technote was successfully created'
        );
    });

    test('Create Wiki', async () => {
        /* c8 ignore next 3 */
        if (!panel) {
            panel = await createAndTestPanel();
        }
        const showQuickPick = this.ctx.sandbox.stub(window, 'showQuickPick');
        showQuickPick.onFirstCall().callsFake(items => {
            assert.ok(items instanceof Array);
            assert.equal(items[1], 'Wiki');
            return Promise.resolve(items[1]);
        });
        const commentStub = this.ctx.sandbox
            .stub(window, 'showInputBox')
            .withArgs(sinon.match({ prompt: 'Name of the wiki entry' }))
            .resolves('wiki_entry');

        const sim: sinon.SinonStub = this.ctx.sandbox
            .stub(window, 'showInformationMessage')
            .resolves();
        await commands.executeCommand('fossil.wikiCreate');
        sinon.assert.calledOnce(commentStub);
        sinon.assert.calledOnceWithExactly(
            sim,
            'Wiki was successfully created'
        );
    });
}

function RevertChangeSuite(this: Suite) {
    test('Revert single change', async () => {
        const rootUri = workspace.workspaceFolders![0].uri;
        const filename = 'revert_change.txt';
        const uriToChange = Uri.joinPath(rootUri, filename);
        await commands.executeCommand('fossil.revertChange', uriToChange); // branch coverage

        const content = [...'abcdefghijklmnopqrstuvwxyz'].join('\n');
        await add(filename, content, `add '${filename}'`);
        const content2 = [
            'top',
            ...'abcdeghijklmn',
            'typo',
            ...'opqrstuvwxyz',
        ].join('\n');
        await fs.writeFile(uriToChange.fsPath, content2);

        const document = await workspace.openTextDocument(uriToChange);
        await window.showTextDocument(document);

        // to fill this array, debug `fossil.revertChange`
        const changes: LineChange[] = [
            {
                originalStartLineNumber: 0,
                originalEndLineNumber: 0,
                modifiedStartLineNumber: 1,
                modifiedEndLineNumber: 1,
            },
            {
                originalStartLineNumber: 6,
                originalEndLineNumber: 6,
                modifiedStartLineNumber: 6,
                modifiedEndLineNumber: 0,
            },
            {
                originalStartLineNumber: 14,
                originalEndLineNumber: 0,
                modifiedStartLineNumber: 15,
                modifiedEndLineNumber: 15,
            },
        ];
        await delay(150);
        await commands.executeCommand(
            'fossil.revertChange',
            uriToChange,
            changes,
            2
        );
        assert.equal(
            document.getText(),
            ['top', ...'abcdeghijklmnopqrstuvwxyz'].join('\n'),
            'undo 1'
        );
        await delay(150);
        await commands.executeCommand(
            'fossil.revertChange',
            uriToChange,
            changes.slice(0, 2),
            1
        );
        assert.equal(
            document.getText(),
            ['top', ...'abcdefghijklmnopqrstuvwxyz'].join('\n'),
            'undo 2'
        );
        await delay(150);
        await commands.executeCommand(
            'fossil.revertChange',
            uriToChange,
            changes.slice(0, 1),
            0
        );
        assert.equal(document.getText(), content, 'undo 3');
        await document.save();
    }).timeout(11000);

    test('Revert nothing', async () => {
        await commands.executeCommand('fossil.revertChange');
    });
}

export function QualityOfLifeSuite(this: Suite): void {
    suite('Praise', PraiseSuite);
    suite('Render', RenderSuite);
    suite('Revert change', RevertChangeSuite);
}
