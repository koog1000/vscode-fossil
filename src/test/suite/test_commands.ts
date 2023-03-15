import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { FossilExecutable, FossilCWD } from '../../fossilExecutable';
import { fossilInit, fossilOpen } from './common';
import * as assert from 'assert/strict';
import * as fs from 'fs/promises';
import { assertGroups } from './test_status';
import { Model } from '../../model';
import { FossilBranch } from '../../openedRepository';
import { Status } from '../../repository';
import { eventToPromise } from '../../util';

export async function fossil_close(
    sandbox: sinon.SinonSandbox,
    executable: FossilExecutable
): Promise<void> {
    await fossilInit(sandbox, executable);
    await fossilOpen(sandbox, executable);
    const cwd = vscode.workspace.workspaceFolders![0].uri.fsPath as FossilCWD;
    const res = await executable.exec(cwd, ['info']);
    assert.ok(/check-ins:\s+1\s*$/.test(res.stdout));
    await vscode.commands.executeCommand('fossil.close');
    const res_promise = executable.exec(cwd, ['status']);
    await assert.rejects(res_promise, (thrown: any): boolean => {
        return /^current directory is not within an open checkout\s*$/.test(
            thrown.stderr
        );
    });
}

export async function fossil_merge(
    sandbox: sinon.SinonSandbox,
    executable: FossilExecutable
): Promise<void> {
    const fooFilename = 'foo-merge.txt';
    const barFilename = 'bar-merge.txt';
    const rootUri = vscode.workspace.workspaceFolders![0].uri;
    const fooPath = vscode.Uri.joinPath(rootUri, fooFilename).fsPath;
    await fs.writeFile(fooPath, 'foo content\n');
    const cwd = rootUri.fsPath as FossilCWD;
    await executable.exec(cwd, ['add', fooFilename]);
    await executable.exec(cwd, [
        'commit',
        '-m',
        `add: ${fooFilename}`,
        '--no-warnings',
    ]);
    const barPath = vscode.Uri.joinPath(rootUri, fooFilename).fsPath;
    await fs.writeFile(barPath, 'bar content\n');
    await executable.exec(cwd, ['add', barFilename]);
    await fs.appendFile(fooPath, 'foo content 2\n');
    await executable.exec(cwd, [
        'commit',
        '-m',
        `add: ${barFilename}; mod`,
        '--no-warnings',
        '--branch',
        'fossil-merge',
    ]);
    await executable.exec(cwd, ['update', 'trunk']);
    const model = vscode.extensions.getExtension('koog1000.fossil')!
        .exports as Model;
    const repository = model.repositories[0];
    await vscode.commands.executeCommand('fossil.refresh');
    await repository.updateModelState();
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

    await repository.updateModelState();
    assertGroups(repository, new Map(), new Map());
}

export async function fossil_rename_a_file(
    sandbox: sinon.SinonSandbox,
    executable: FossilExecutable
): Promise<void> {
    const oldFilename = 'not_renamed.txt';
    const newFilename = 'renamed.txt';
    const rootUri = vscode.workspace.workspaceFolders![0].uri;
    const fooPath = vscode.Uri.joinPath(rootUri, oldFilename).fsPath;
    await fs.writeFile(fooPath, 'foo content\n');
    const cwd = rootUri.fsPath as FossilCWD;
    await executable.exec(cwd, ['add', oldFilename]);
    await executable.exec(cwd, [
        'commit',
        '-m',
        `add: ${oldFilename}`,
        '--no-warnings',
    ]);

    const showInformationMessage: sinon.SinonStub = sandbox.stub(
        vscode.window,
        'showInformationMessage'
    );

    const answeredYes = showInformationMessage.onFirstCall().resolves('Yes');

    const edit = new vscode.WorkspaceEdit();
    const newFilePath = vscode.Uri.joinPath(rootUri, newFilename);
    edit.renameFile(vscode.Uri.joinPath(rootUri, oldFilename), newFilePath);

    const success = await vscode.workspace.applyEdit(edit);
    assert.ok(success);

    const model = vscode.extensions.getExtension('koog1000.fossil')!
        .exports as Model;
    const repository = model.repositories[0];
    await answeredYes;
    await eventToPromise(repository.onDidRunOperation);
    await repository.updateModelState();

    assertGroups(
        repository,
        new Map([[newFilePath.fsPath, Status.RENAMED]]),
        new Map()
    );
}

export async function fossil_rename_a_directory(
    sandbox: sinon.SinonSandbox,
    executable: FossilExecutable
): Promise<void> {
    const oldDirname = 'not_renamed';
    const newDirname = 'renamed';
    const rootUri = vscode.workspace.workspaceFolders![0].uri;
    const oldDirUrl = vscode.Uri.joinPath(rootUri, oldDirname);
    const newDirUrl = vscode.Uri.joinPath(rootUri, newDirname);
    await fs.mkdir(oldDirUrl.fsPath);
    const filenames = ['mud', 'cabbage', 'brick'];
    const oldUris = filenames.map(filename =>
        vscode.Uri.joinPath(oldDirUrl, filename)
    );
    const newUris = filenames.map(filename =>
        vscode.Uri.joinPath(newDirUrl, filename)
    );

    await Promise.all(
        oldUris.map(uri => fs.writeFile(uri.fsPath, `foo ${uri}\n`))
    );
    const cwd = rootUri.fsPath as FossilCWD;
    await executable.exec(cwd, ['add', oldDirname]);
    await executable.exec(cwd, [
        'commit',
        '-m',
        `add directory: ${oldDirname}`,
        '--no-warnings',
    ]);

    const showInformationMessage: sinon.SinonStub = sandbox.stub(
        vscode.window,
        'showInformationMessage'
    );

    const answeredYes = showInformationMessage.onFirstCall().resolves('Yes');

    const edit = new vscode.WorkspaceEdit();
    edit.renameFile(oldDirUrl, newDirUrl);

    const success = await vscode.workspace.applyEdit(edit);
    assert.ok(success);

    const model = vscode.extensions.getExtension('koog1000.fossil')!
        .exports as Model;
    const repository = model.repositories[0];
    await answeredYes;
    await eventToPromise(repository.onDidRunOperation);
    await repository.updateModelState();

    const ref: [string, Status][] = newUris.map((url: vscode.Uri) => [
        url.fsPath,
        Status.RENAMED,
    ]);
    assertGroups(repository, new Map(ref), new Map());
}
