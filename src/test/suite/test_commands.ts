import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { FossilExecutable, FossilCWD } from '../../fossilExecutable';
import { add, fossilInit, fossilOpen } from './common';
import * as assert from 'assert/strict';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import { assertGroups } from './test_status';
import { Model } from '../../model';
import { FossilBranch, OpenedRepository } from '../../openedRepository';
import { Status } from '../../repository';
import { eventToPromise } from '../../util';
import { LineChange } from '../../revert';

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

export async function fossil_ignore(
    sandbox: sinon.SinonSandbox,
    executable: FossilExecutable
): Promise<void> {
    const rootUri = vscode.workspace.workspaceFolders![0].uri;
    const uriToIgnore = vscode.Uri.joinPath(rootUri, 'autogenerated');
    const urlIgnoredGlob = vscode.Uri.joinPath(
        rootUri,
        '.fossil-settings',
        'ignore-glob'
    );
    fs.writeFile(uriToIgnore.fsPath, `autogenerated\n`);

    const model = vscode.extensions.getExtension('koog1000.fossil')!
        .exports as Model;
    const repository = model.repositories[0];
    await repository.updateModelState();
    const resource = repository.untrackedGroup.getResource(uriToIgnore);
    assert.ok(resource);
    assert.ok(!existsSync(urlIgnoredGlob.fsPath));

    await document_was_shown(sandbox, urlIgnoredGlob.fsPath, [], () =>
        vscode.commands.executeCommand('fossil.ignore', resource)
    );
    const globIgnore = await fs.readFile(urlIgnoredGlob.fsPath);
    assert.equal(globIgnore.toString('utf-8'), 'autogenerated\n');
    const cwd = vscode.workspace.workspaceFolders![0].uri.fsPath as FossilCWD;
    await executable.exec(cwd, ['commit', '-m', 'fossil_ignore_new']);

    // now append to ignore list
    const uriToIgnore2 = vscode.Uri.joinPath(rootUri, 'autogenerated2');
    fs.writeFile(uriToIgnore2.fsPath, `autogenerated2\n`);
    await repository.updateModelState();
    const resource2 = repository.untrackedGroup.getResource(uriToIgnore2);
    assert.ok(resource2);
    await document_was_shown(sandbox, urlIgnoredGlob.fsPath, [], () =>
        vscode.commands.executeCommand('fossil.ignore', resource2)
    );

    const globIgnore2 = await fs.readFile(urlIgnoredGlob.fsPath);
    assert.equal(
        globIgnore2.toString('utf-8'),
        'autogenerated\nautogenerated2\n'
    );
    await executable.exec(cwd, ['commit', '-m', 'fossil_ignore_new_2']);
}

async function document_was_shown(
    sandbox: sinon.SinonSandbox,
    urlMatch: any,
    showMatch: any[],
    body: () => Thenable<void>
) {
    const openTextDocument = sandbox.stub(
        vscode.workspace,
        'openTextDocument'
    ) as sinon.SinonStub;
    openTextDocument.resolves(42);

    const showTextDocument = sandbox.stub(
        vscode.window,
        'showTextDocument'
    ) as sinon.SinonStub;
    showTextDocument.resolves(undefined);

    await body();

    assert.ok(openTextDocument.calledOnceWith(urlMatch));
    assert.ok(showTextDocument.calledOnceWith(42, ...showMatch));

    openTextDocument.restore();
    showTextDocument.restore();
}

export async function fossil_open_files(
    sandbox: sinon.SinonSandbox,
    _executable: FossilExecutable
): Promise<void> {
    await vscode.commands.executeCommand('fossil.openFiles'); // coverage

    const rootUri = vscode.workspace.workspaceFolders![0].uri;
    const uriToOpen = vscode.Uri.joinPath(rootUri, 'a file to open.txt');
    fs.writeFile(uriToOpen.fsPath, `text inside\n`);

    const model = vscode.extensions.getExtension('koog1000.fossil')!
        .exports as Model;
    const repository = model.repositories[0];
    await repository.updateModelState();
    const resource = repository.untrackedGroup.getResource(uriToOpen);
    assert.ok(resource);

    await document_was_shown(
        sandbox,
        sinon.match({ path: uriToOpen.path }),
        [
            {
                preserveFocus: true,
                preview: true,
                viewColumn: vscode.ViewColumn.Active,
            },
        ],
        () => vscode.commands.executeCommand('fossil.openFiles', resource)
    );
}

export async function fossil_revert_change(
    sandbox: sinon.SinonSandbox,
    executable: FossilExecutable
): Promise<void> {
    const rootUri = vscode.workspace.workspaceFolders![0].uri;
    const cwd = rootUri.fsPath as FossilCWD;
    const filename = 'revert_change.txt';
    const uriToChange = vscode.Uri.joinPath(rootUri, filename);
    await vscode.commands.executeCommand('fossil.revertChange', uriToChange); // branch coverage

    const content = [...'abcdefghijklmnopqrstuvwxyz'].join('\n');
    fs.writeFile(uriToChange.fsPath, content);
    await executable.exec(cwd, ['add', filename]);
    await executable.exec(cwd, ['commit', filename, '-m', `add '${filename}'`]);
    const content2 = [...'abcdefghijklmn', 'typo', ...'opqrstuvwxyz'].join(
        '\n'
    );
    fs.writeFile(uriToChange.fsPath, content2);

    const document = await vscode.workspace.openTextDocument(uriToChange);
    await vscode.window.showTextDocument(document);

    const line_change: LineChange = {
        modifiedEndLineNumber: 15,
        modifiedStartLineNumber: 15,
        originalEndLineNumber: 0,
        originalStartLineNumber: 14,
    };
    await vscode.commands.executeCommand(
        'fossil.revertChange',
        uriToChange,
        [line_change],
        0
    );
    const revertedContent = document.getText();
    assert.equal(revertedContent, content);
    await document.save();

    await vscode.commands.executeCommand('fossil.revertChange'); // ranch coverage
}

export async function fossil_pull_with_autoUpdate_on(
    sandbox: sinon.SinonSandbox,
    _executable: FossilExecutable
): Promise<void> {
    const model = vscode.extensions.getExtension('koog1000.fossil')!
        .exports as Model;
    const repository: OpenedRepository = (model.repositories[0] as any)
        .repository;
    const execStub = sandbox.stub(repository, 'exec');
    const updateCall = execStub.withArgs(['update']);
    execStub.callThrough();
    await vscode.commands.executeCommand('fossil.pull');
    assert.ok(updateCall.calledOnce);
}

export async function fossil_pull_with_autoUpdate_off(
    sandbox: sinon.SinonSandbox,
    _executable: FossilExecutable
): Promise<void> {
    const model = vscode.extensions.getExtension('koog1000.fossil')!
        .exports as Model;
    const repository: OpenedRepository = (model.repositories[0] as any)
        .repository;
    const fossilConfig = vscode.workspace.getConfiguration(
        'fossil',
        vscode.workspace.workspaceFolders![0].uri
    );
    await fossilConfig.update('autoUpdate', false);
    const execStub = sandbox.stub(repository, 'exec');
    const updateCall = execStub.withArgs(['pull']);
    updateCall.resolves(undefined); // stub as 'undefined' as we can't do pull
    execStub.callThrough();
    await vscode.commands.executeCommand('fossil.pull');
    assert.ok(updateCall.calledOnce);
}

export async function fossil_revert_single_resource(
    sandbox: sinon.SinonSandbox,
    executable: FossilExecutable
): Promise<void> {
    const url = await add(
        executable,
        'revert_me.txt',
        'Some original text\n',
        'add revert_me.txt'
    );
    await fs.writeFile(url.fsPath, 'something new');
    const model = vscode.extensions.getExtension('koog1000.fossil')!
        .exports as Model;
    const repository = model.repositories[0];
    await repository.updateModelState();
    const resource = repository.workingGroup.getResource(url);
    assert.ok(resource);

    const showWarningMessage: sinon.SinonStub = sandbox.stub(
        vscode.window,
        'showWarningMessage'
    );
    showWarningMessage.onFirstCall().resolves('&&Discard Changes');

    await vscode.commands.executeCommand('fossil.revert', resource);
    const newContext = await fs.readFile(url.fsPath);
    assert.equal(newContext.toString('utf-8'), 'Some original text\n');
}

export async function fossil_open_resource(
    sandbox: sinon.SinonSandbox,
    executable: FossilExecutable
): Promise<void> {
    const url = await add(
        executable,
        'open_resource.txt',
        'Some original text\n',
        'add open_resource.txt'
    );
    await fs.writeFile(url.fsPath, 'something new');

    const model = vscode.extensions.getExtension('koog1000.fossil')!
        .exports as Model;
    const repository = model.repositories[0];
    await repository.updateModelState();
    const resource = repository.workingGroup.getResource(url);
    assert.ok(resource);

    const execStub = sandbox.stub(vscode.commands, 'executeCommand');
    const diffCall = execStub.withArgs('vscode.diff');
    execStub.callThrough();

    await vscode.commands.executeCommand('fossil.openResource', resource);

    assert.ok(diffCall.calledOnce);

    await vscode.commands.executeCommand('fossil.openResource', undefined);
}
