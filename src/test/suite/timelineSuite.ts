import * as vscode from 'vscode';
import { window, Uri } from 'vscode';
import * as assert from 'assert/strict';
import { toFossilUri } from '../../uri';
import { FossilCWD } from '../../fossilExecutable';
import { add, cleanupFossil, getExecutable, getRepository } from './common';
import { Suite } from 'mocha';
import * as sinon from 'sinon';

export function timelineSuite(this: Suite): void {
    test('fossil file log can differ files', async () => {
        const repository = getRepository();
        await cleanupFossil(repository);
        await add('file1.txt', 'line1\n', 'file1.txt: first');
        await add('file1.txt', 'line1\nline2\n', 'file1.txt: second', 'SKIP');
        await add(
            'file1.txt',
            'line1\nline2\nline3\n',
            'file1.txt: third',
            'SKIP'
        );
        await add('file2.txt', 'line1\n', 'file2.txt: first');
        await add('file2.txt', 'line1\nline2\n', 'file2.txt: second', 'SKIP');
        const file2uri = await add(
            'file2.txt',
            'line1\nline2\nline3\n',
            'file2.txt: third',
            'SKIP'
        );
        const showQuickPick = this.ctx.sandbox.stub(window, 'showQuickPick');
        showQuickPick.onFirstCall().callsFake(items => {
            assert.ok(items instanceof Array);
            assert.equal(items[0].label, '$(tag) Current');
            return Promise.resolve(items[0]);
        });
        showQuickPick.onSecondCall().callsFake(items => {
            assert.ok(items instanceof Array);
            assert.equal(items[0].label, '$(circle-outline) Parent');
            return Promise.resolve(items[0]);
        });

        const executeCommand = this.ctx.sandbox.stub(
            vscode.commands,
            'executeCommand'
        );
        executeCommand
            .withArgs('vscode.diff')
            .callsFake(
                async (
                    command: string,
                    left: Uri,
                    right: Uri,
                    title: string,
                    _opts: unknown
                ): Promise<unknown> => {
                    const parentHash = await repository.getInfo(
                        'current',
                        'parent'
                    );
                    assert.deepEqual(left, toFossilUri(file2uri, 'current'));
                    assert.deepEqual(right, toFossilUri(file2uri, parentHash));
                    assert.equal(
                        title,
                        `file2.txt (current vs. ${parentHash.slice(0, 12)})`
                    );
                    return Promise.resolve();
                }
            );
        executeCommand.callThrough();

        await vscode.commands.executeCommand('fossil.fileLog', file2uri);
        sinon.assert.calledTwice(showQuickPick);
    }).timeout(10000);
    test('fossil can amend commit message', async () => {
        const rootUri = vscode.workspace.workspaceFolders![0].uri;
        const cwd = rootUri.fsPath as FossilCWD;

        const repository = getRepository();
        await cleanupFossil(repository);
        await add('amend.txt', '\n', 'message to amend');

        const showQuickPick = this.ctx.sandbox.stub(window, 'showQuickPick');
        showQuickPick.onFirstCall().callsFake(items => {
            assert.ok(items instanceof Array);
            assert.equal(items[0].label, '$(git-branch) trunk');
            return Promise.resolve(items[0]);
        });
        showQuickPick.onSecondCall().callsFake(items => {
            assert.ok(items instanceof Array);
            assert.equal(items[1].label, '$(tag) Current');
            return Promise.resolve(items[1]);
        });
        showQuickPick.onThirdCall().callsFake(items => {
            assert.ok(items instanceof Array);
            assert.equal(items[1].label, '$(edit) Edit commit message');
            return Promise.resolve(items[1]);
        });
        const messageStub = this.ctx.sandbox
            .stub(window, 'showInputBox')
            .withArgs(sinon.match({ placeHolder: 'Commit message' }))
            .resolves('updated commit message');
        const sim: sinon.SinonStub = this.ctx.sandbox
            .stub(window, 'showInformationMessage')
            .resolves();

        await vscode.commands.executeCommand('fossil.log');
        sinon.assert.calledOnceWithExactly(messageStub, {
            value: 'message to amend',
            placeHolder: 'Commit message',
            prompt: 'Please provide a commit message',
            ignoreFocusOut: true,
        });
        sinon.assert.calledOnceWithExactly(sim, 'Commit message was updated.');

        const executable = getExecutable();
        const stdout = (await executable.exec(cwd, ['info'])).stdout;
        assert.match(stdout, /updated commit message/m);
    }).timeout(5000);
}
