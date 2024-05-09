import * as vscode from 'vscode';
import { window } from 'vscode';
import * as assert from 'assert/strict';
import { FossilUriParams, toFossilUri } from '../../uri';
import type { FossilCWD } from '../../fossilExecutable';
import { add, cleanupFossil, getExecutable, getRepository } from './common';
import { Suite, before } from 'mocha';
import * as sinon from 'sinon';
import type { FossilCheckin } from '../../openedRepository';

// separate function because hash size is different
const uriMatch = (uri: vscode.Uri, checkin: FossilCheckin) =>
    sinon.match((exp: vscode.Uri): boolean => {
        const exp_q = JSON.parse(exp.query) as FossilUriParams;
        return (
            uri.path == exp.path &&
            uri.fsPath == exp_q.path &&
            exp_q.checkin.slice(0, 40) == checkin
        );
    });

export function timelineSuite(this: Suite): void {
    let file2uri: vscode.Uri;

    before(async () => {
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
        file2uri = await add(
            'file2.txt',
            'line1\nline2\nline3\n',
            'file2.txt: third',
            'SKIP'
        );
    });

    test('`fossil.fileLog` undefined', async () => {
        await vscode.commands.executeCommand('fossil.fileLog');
    });

    test('Show diff from `fossil.fileLog`', async () => {
        const repository = getRepository();
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

        const diffCommand = this.ctx.sandbox
            .stub(vscode.commands, 'executeCommand')
            .callThrough()
            .withArgs('vscode.diff')
            .resolves();

        await vscode.commands.executeCommand('fossil.fileLog', file2uri);
        sinon.assert.calledTwice(showQuickPick);

        const parentHash = await repository.getInfo('current', 'parent');
        sinon.assert.calledOnceWithExactly(
            diffCommand,
            'vscode.diff',
            toFossilUri(file2uri, 'current'),
            toFossilUri(file2uri, parentHash),
            `file2.txt (current vs. ${parentHash.slice(0, 12)})`
        );
    }).timeout(2000);

    const testDiff = async (
        callback: (
            items: readonly vscode.QuickPickItem[]
        ) => Thenable<vscode.QuickPickItem>
    ) => {
        const repository = getRepository();
        const showQuickPick = this.ctx.sandbox.stub(window, 'showQuickPick');
        showQuickPick.onFirstCall().callsFake(items => {
            assert.ok(items instanceof Array);
            assert.equal(items[0].label, '$(tag) Current');
            return Promise.resolve(items[0]);
        });
        showQuickPick.onSecondCall().callsFake(items => {
            assert.ok(items instanceof Array);
            return callback(items);
        });

        const diffCommand = this.ctx.sandbox
            .stub(vscode.commands, 'executeCommand')
            .callThrough()
            .withArgs('vscode.diff')
            .resolves();

        await vscode.commands.executeCommand('fossil.log');
        sinon.assert.calledTwice(showQuickPick);

        const currentHash = await repository.getInfo('current', 'hash');
        const parentHash = await repository.getInfo(currentHash, 'parent');

        sinon.assert.calledOnceWithExactly(
            diffCommand,
            'vscode.diff',
            uriMatch(file2uri, parentHash),
            uriMatch(file2uri, currentHash),
            `file2.txt (${parentHash.slice(0, 12)} vs. ${currentHash.slice(
                0,
                12
            )})`,
            { preview: false }
        );
    };

    test('Show diff from `fossil.Log`', async () => {
        await testDiff(items => {
            assert.equal(items[4].label, '    Ｍ  file2.txt');
            return Promise.resolve(items[4]);
        });
    });

    test('Show diff all from `fossil.Log`', async () => {
        await testDiff(items => {
            assert.equal(
                items[2].label,
                '$(go-to-file) Open all changed files'
            );
            return Promise.resolve(items[2]);
        });
    });

    test('Amend commit message', async () => {
        const rootUri = vscode.workspace.workspaceFolders![0].uri;
        const cwd = rootUri.fsPath as FossilCWD;

        await add('amend.txt', '\n', 'message to amend');

        const showQuickPick = this.ctx.sandbox.stub(window, 'showQuickPick');
        showQuickPick.onFirstCall().callsFake(items => {
            assert.ok(items instanceof Array);
            assert.equal(items[0].label, '$(tag) Current');
            return Promise.resolve(items[0]);
        });
        showQuickPick.onSecondCall().callsFake(items => {
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
        sinon.assert.calledTwice(showQuickPick);
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
