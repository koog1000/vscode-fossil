import { Suite, test } from 'mocha';
import { commands, window, workspace, Uri } from 'vscode';
import * as assert from 'assert/strict';
import * as fs from 'fs/promises';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { getRepository } from './common';
import { OpenedRepository } from '../../openedRepository';

async function PraiseSuite(this: Suite) {
    test('Praise nothing', async () => {
        assert.ok(!window.activeTextEditor);
        await commands.executeCommand('fossil.praise');
    });
    test('Praise file', async () => {
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
                path,
                '-m',
                `praise ${n}`,
                '--user-override',
                `u${n}`,
            ]);
        await openedRepository.exec(['add', path]);
        await ci(1);
        await fs.appendFile(path, [...'second', ''].join('\n'));
        await ci(2);
        await fs.appendFile(path, [...'third', ''].join('\n'));
        await ci(3);
        await fs.appendFile(path, [...'user', ''].join('\n'));

        await commands.executeCommand('vscode.open', vscode.Uri.file(path));
        assert.ok(window.activeTextEditor);
        assert.equal(window.activeTextEditor.document.uri.fsPath, uri.fsPath);
        // we can't stub `setDecorations`, but what else can we check?
        // const setDecorations = this.ctx.sandbox.spy(vscode.window.activeTextEditor!, 'setDecorations');
        await commands.executeCommand('fossil.praise');
        // sinon.assert.calledOnceWithExactly(setDecorations, sinon.match.object);
    }).timeout(30000); // sometimes io is unpredictable
}

async function RenderSuite(this: Suite) {
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
        const postMessageStub = this.ctx.sandbox.stub(
            panel.webview,
            'postMessage'
        );
        const postedMessage = await new Promise<any>(c => {
            postMessageStub.callsFake((message: any): Thenable<boolean> => {
                const ret = postMessageStub.wrappedMethod(message);
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

export function QualityOfLifeSuite(this: Suite): void {
    suite('Praise', PraiseSuite);
    suite('Render', RenderSuite);
}
