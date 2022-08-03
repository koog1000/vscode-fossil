import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { Fossil, FossilBranch, FossilCWD } from '../../fossilBase';
import { fossilInit, fossilOpen } from './common';
import * as assert from 'assert/strict';
import * as fs from 'fs/promises';
import { assertGroups } from './test_status';
import { eventToPromise } from '../../util';
import { Model } from '../../model';

export async function fossil_close(
    sandbox: sinon.SinonSandbox,
    fossil: Fossil
): Promise<void> {
    await fossilInit(sandbox, fossil);
    await fossilOpen(sandbox, fossil);
    const cwd = vscode.workspace.workspaceFolders![0].uri.fsPath as FossilCWD;
    const res = await fossil.exec(cwd, ['info']);
    assert.ok(/check-ins:\s+1\s*$/.test(res.stdout));
    await vscode.commands.executeCommand('fossil.close');
    const res_promise = fossil.exec(cwd, ['status']);
    await assert.rejects(res_promise, (thrown: any): boolean => {
        return /^current directory is not within an open checkout\s*$/.test(
            thrown.stderr
        );
    });
}

export async function fossil_merge(
    sandbox: sinon.SinonSandbox,
    fossil: Fossil
): Promise<void> {
    await fossilInit(sandbox, fossil);
    await fossilOpen(sandbox, fossil);
    const rootUri = vscode.workspace.workspaceFolders![0].uri;
    const fooPath = vscode.Uri.joinPath(rootUri, 'foo.txt').fsPath;
    await fs.writeFile(fooPath, 'foo content\n');
    const cwd = rootUri.fsPath as FossilCWD;
    await fossil.exec(cwd, ['add', 'foo.txt']);
    await fossil.exec(cwd, ['commit', '-m', 'add: foo.txt', '--no-warnings']);
    const barPath = vscode.Uri.joinPath(rootUri, 'foo.txt').fsPath;
    await fs.writeFile(barPath, 'bar content\n');
    await fossil.exec(cwd, ['add', 'bar.txt']);
    await fs.appendFile(fooPath, 'foo content 2\n');
    await fossil.exec(cwd, [
        'commit',
        '-m',
        'add: bar.txt; mod',
        '--no-warnings',
        '--branch',
        'fossil-merge',
    ]);
    await fossil.exec(cwd, ['up', 'trunk']);
    const model = vscode.extensions.getExtension('koog1000.fossil')!
        .exports as Model;
    const repository = model.repositories[0];
    await vscode.commands.executeCommand('fossil.refresh');
    await eventToPromise(repository.onDidRunOperation);
    assertGroups(repository, new Map(), new Map());

    const showQuickPickstub = sandbox.stub(
        vscode.window,
        'showQuickPick'
    ) as sinon.SinonStub;
    showQuickPickstub.resolves({ checkin: 'fossil-merge' as FossilBranch });
    const showInputBoxstub = sandbox.stub(vscode.window, 'showInputBox');
    showInputBoxstub.resolves('test merge message');

    await vscode.commands.executeCommand('fossil.merge');
    assert.ok(showQuickPickstub.calledOnce);
    assert.ok(showInputBoxstub.calledOnce);

    await eventToPromise(repository.onDidRunOperation);
    await repository.status();
    assertGroups(repository, new Map(), new Map());
}
