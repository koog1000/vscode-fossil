import * as vscode from 'vscode';
import { cleanRoot, fossilInit, fossilOpen, getExecutable } from './common';
import * as sinon from 'sinon';
import * as assert from 'assert/strict';
import { FossilCWD } from '../../fossilExecutable';
import { afterEach } from 'mocha';

suite('Setup', () => {
    const sandbox = sinon.createSandbox();

    afterEach(() => {
        sandbox.restore();
    });

    test('Init', async () => {
        await cleanRoot();
        await fossilInit(sandbox);
    }).timeout(2000);

    test('Close', async () => {
        await cleanRoot();
        await fossilInit(sandbox);
        await fossilOpen(sandbox);
        const cwd = vscode.workspace.workspaceFolders![0].uri
            .fsPath as FossilCWD;
        const executable = getExecutable();
        const res = await executable.exec(cwd, ['info']);
        assert.match(res.stdout, /check-ins:\s+1\s*$/);
        await vscode.commands.executeCommand('fossil.close');
        const res_promise = executable.exec(cwd, ['status']);
        await assert.rejects(res_promise, (thrown: any): boolean => {
            return /^current directory is not within an open check-?out\s*$/.test(
                thrown.stderr
            );
        });
    }).timeout(5000);
});
