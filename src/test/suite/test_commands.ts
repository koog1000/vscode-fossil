import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { Fossil, FossilCWD } from '../../fossilBase';
import { fossilInit, fossilOpen } from './common';
import * as assert from 'assert/strict';

export async function fossil_close(
    sandbox: sinon.SinonSandbox,
    fossil: Fossil
): Promise<void> {
    await fossilInit(sandbox);
    await fossilOpen(sandbox, fossil);
    const cwd = vscode.workspace.workspaceFolders![0].uri.fsPath as FossilCWD;
    const res = await fossil.exec(cwd, ['info']);
    assert.ok(/check-ins:\s+1\s*$/.test(res.stdout));
    await vscode.commands.executeCommand('fossil.close');
    const res_promise = fossil.exec(cwd, ['status']);
    await assert.rejects(res_promise, (thrown: any) => {
        return /^current directory is not within an open checkout\s*$/.test(
            thrown.stderr
        );
    });
}
