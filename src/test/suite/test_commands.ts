import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { FossilExecutable, FossilCWD } from '../../fossilExecutable';
import { add, fossilInit, fossilOpen, getRepository } from './common';
import * as assert from 'assert/strict';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import { assertGroups } from './test_status';
import { FossilBranch, OpenedRepository } from '../../openedRepository';
import { Status } from '../../repository';
import { eventToPromise } from '../../util';
import { LineChange } from '../../revert';
import { Suite, afterEach } from 'mocha';
import { IExecutionResult } from '../../fossilExecutable';

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
        return /^current directory is not within an open check-?out\s*$/.test(
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

    const repository = getRepository();
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

    const repository = getRepository();
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

    const repository = getRepository();
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

    const repository = getRepository();
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

    const repository = getRepository();
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

    await vscode.commands.executeCommand('fossil.revertChange'); // better coverage
}

export async function fossil_pull_with_autoUpdate_on(
    sandbox: sinon.SinonSandbox,
    _executable: FossilExecutable
): Promise<void> {
    const repository = getRepository();
    const openedRepository: OpenedRepository = (repository as any).repository;
    const execStub = sandbox.stub(openedRepository, 'exec');
    const updateCall = execStub.withArgs(['update']);
    execStub.callThrough();
    await vscode.commands.executeCommand('fossil.pull');
    assert.ok(updateCall.calledOnce);
}

export async function fossil_pull_with_autoUpdate_off(
    sandbox: sinon.SinonSandbox,
    _executable: FossilExecutable
): Promise<void> {
    const repository = getRepository();
    const openedRepository: OpenedRepository = (repository as any).repository;
    const fossilConfig = vscode.workspace.getConfiguration(
        'fossil',
        vscode.workspace.workspaceFolders![0].uri
    );
    await fossilConfig.update('autoUpdate', false);
    const execStub = sandbox.stub(openedRepository, 'exec');
    const updateCall = execStub.withArgs(['pull']);
    updateCall.resolves(undefined); // stub as 'undefined' as we can't do pull
    execStub.callThrough();
    await vscode.commands.executeCommand('fossil.pull');
    assert.ok(updateCall.calledOnce);
}

function fakeFossilStatus<T extends sinon.SinonStub>(
    execStub: T,
    status: string
) {
    return execStub.withArgs(['status']).resolves({
        fossilPath: '',
        exitCode: 0,
        stdout: status, // fake_status.join('\n'),
        stderr: '',
        args: ['status'],
        cwd: '',
    } as unknown as IExecutionResult);
}

export function fossil_revert_suite(sandbox: sinon.SinonSandbox): void {
    suite('Revert', function (this: Suite) {
        test('Single source', async () => {
            const url = await add(
                'revert_me.txt',
                'Some original text\n',
                'add revert_me.txt'
            );
            await fs.writeFile(url.fsPath, 'something new');

            const repository = getRepository();
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
        });
        test('Dialog has no typos', async () => {
            const repository = getRepository();
            const rootUri = vscode.workspace.workspaceFolders![0].uri;
            const fake_status = [];
            const openedRepository: OpenedRepository = (repository as any)
                .repository;
            const execStub = sandbox.stub(openedRepository, 'exec');
            const fileUris: vscode.Uri[] = [];
            for (const filename of 'abcdefghijklmn') {
                const fileUri = vscode.Uri.joinPath(rootUri, 'added', filename);
                fake_status.push(`EDITED     added/${filename}`);
                fileUris.push(fileUri);
            }
            execStub.callThrough();
            const statusCall = fakeFossilStatus(
                execStub,
                fake_status.join('\n')
            );
            await repository.updateModelState();
            assert.ok(statusCall.calledOnce);
            const resources = fileUris.map(uri => {
                const resource = repository.workingGroup.getResource(uri);
                assert.ok(resource);
                return resource;
            });
            const showWarningMessage: sinon.SinonStub = sandbox.stub(
                vscode.window,
                'showWarningMessage'
            );
            await vscode.commands.executeCommand('fossil.revert', ...resources);
            assert.ok(
                showWarningMessage.firstCall.calledWith(
                    'Are you sure you want to discard changes to 14 files?\n\n • a\n • b\n • c\n • d\n • e\n • f\n • g\n • h\nand 6 others'
                )
            );
            await vscode.commands.executeCommand(
                'fossil.revert',
                ...resources.slice(0, 3)
            );
            assert.ok(
                showWarningMessage.secondCall.calledWith(
                    'Are you sure you want to discard changes to 3 files?\n\n • a\n • b\n • c'
                )
            );
        });
    });
}

export async function fossil_open_resource(
    sandbox: sinon.SinonSandbox
): Promise<void> {
    const url = await add(
        'open_resource.txt',
        'Some original text\n',
        'add open_resource.txt'
    );
    await fs.writeFile(url.fsPath, 'something new');

    const repository = getRepository();
    await repository.updateModelState();
    const resource = repository.workingGroup.getResource(url);
    assert.ok(resource);

    const execStub = sandbox.stub(vscode.commands, 'executeCommand');
    const diffCall = execStub.withArgs('vscode.diff');
    execStub.callThrough();

    await vscode.commands.executeCommand('fossil.openResource', resource);

    assert.ok(diffCall.calledOnce);

    await vscode.commands.executeCommand('fossil.openResource');
}

export async function fossil_add(): Promise<void> {
    const root = vscode.workspace.workspaceFolders![0].uri;
    const uri = vscode.Uri.joinPath(root, 'add.txt');
    await fs.writeFile(uri.fsPath, 'fossil_add');

    const repository = getRepository();
    await repository.updateModelState();
    const resource = repository.untrackedGroup.getResource(uri);
    assert.ok(resource);

    await vscode.commands.executeCommand('fossil.add', resource);
    await repository.updateModelState();
    assert(!repository.untrackedGroup.includesUri(uri));
    assert(repository.stagingGroup.includesUri(uri));
    await vscode.commands.executeCommand('fossil.add');
    await vscode.commands.executeCommand('fossil.add', undefined);
}

export async function fossil_change_branch_to_trunk(
    sandbox: sinon.SinonSandbox
): Promise<void> {
    const repository = getRepository();
    const openedRepository: OpenedRepository = (repository as any).repository;
    const execStub = sandbox.stub(openedRepository, 'exec');
    const updateCall = execStub.withArgs(['update', 'trunk']);
    updateCall.resolves(undefined);
    execStub.callThrough();

    const showQuickPick = sandbox.stub(vscode.window, 'showQuickPick');
    showQuickPick.onFirstCall().callsFake(items => {
        assert.ok(items instanceof Array);
        assert.equal(items[2].label, '$(git-branch) trunk');
        return Promise.resolve(items[2]);
    });

    await vscode.commands.executeCommand('fossil.branchChange');

    assert.ok(updateCall.calledOnce);
}

export async function fossil_change_branch_to_hash(
    sandbox: sinon.SinonSandbox,
    executable: FossilExecutable
): Promise<void> {
    const cwd = vscode.workspace.workspaceFolders![0].uri.fsPath as FossilCWD;
    await executable.exec(cwd, ['revert']);
    await executable.exec(cwd, ['clean']);

    const repository = getRepository();
    const openedRepository: OpenedRepository = (repository as any).repository;
    const execStub = sandbox.stub(openedRepository, 'exec');
    const updateCall = execStub.withArgs(['update', '1234567890']);
    updateCall.resolves(undefined);
    execStub.callThrough();

    const showQuickPick = sandbox.stub(vscode.window, 'showQuickPick');
    showQuickPick.onFirstCall().callsFake(items => {
        assert.ok(items instanceof Array);
        assert.equal(items[0].label, '$(pencil) Checkout by hash');
        return Promise.resolve(items[0]);
    });
    const showInputBox = sandbox.stub(vscode.window, 'showInputBox');
    showInputBox.onFirstCall().resolves('1234567890');
    await vscode.commands.executeCommand('fossil.branchChange');

    assert.ok(showInputBox.calledOnce);
    assert.ok(updateCall.calledOnce);
}

export function fossil_stash_suite(sandbox: sinon.SinonSandbox): void {
    suite('Stash', function (this: Suite) {
        afterEach(() => {
            sandbox.restore();
        });

        this.timeout(12000);
        test('Save', async () => {
            const repository = getRepository();
            const openedRepository: OpenedRepository = (repository as any)
                .repository;
            const uri = vscode.Uri.joinPath(
                vscode.workspace.workspaceFolders![0].uri,
                'stash.txt'
            );
            await fs.writeFile(uri.fsPath, 'stash me');

            const showInputBox = sandbox.stub(vscode.window, 'showInputBox');
            showInputBox.onFirstCall().resolves('stashSave commit message');

            const execStub = sandbox.stub(openedRepository, 'exec');
            const stashSave = execStub.withArgs([
                'stash',
                'save',
                '-m',
                'stashSave commit message',
                'stash.txt',
            ]);
            execStub.callThrough();
            await repository.updateModelState();
            const resource = repository.untrackedGroup.getResource(uri);
            assert.ok(resource);
            await vscode.commands.executeCommand('fossil.add', resource);
            await vscode.commands.executeCommand('fossil.stashSave');
            assert.ok(stashSave.calledOnce);
        });
        test('Apply', async () => {
            const repository = getRepository();
            const openedRepository: OpenedRepository = (repository as any)
                .repository;

            const execStub = sandbox.stub(openedRepository, 'exec');
            const stashApply = execStub.withArgs(['stash', 'apply', '1']);
            const showQuickPick = sandbox.stub(vscode.window, 'showQuickPick');
            showQuickPick.onFirstCall().callsFake(items => {
                assert.ok(items instanceof Array);
                assert.match(
                    items[0].label,
                    /\$\(circle-outline\) 1 • [a-f0-9]{12}/
                );
                return Promise.resolve(items[0]);
            });
            execStub.callThrough();
            await vscode.commands.executeCommand('fossil.stashApply');
            assert.ok(stashApply.calledOnce);
        });
        test('Drop', async () => {
            const repository = getRepository();
            const openedRepository: OpenedRepository = (repository as any)
                .repository;

            const execStub = sandbox.stub(openedRepository, 'exec');
            const stashApply = execStub.withArgs(['stash', 'drop', '1']);
            const showQuickPick = sandbox.stub(vscode.window, 'showQuickPick');
            showQuickPick.onFirstCall().callsFake(items => {
                assert.ok(items instanceof Array);
                assert.match(
                    items[0].label,
                    /\$\(circle-outline\) 1 • [a-f0-9]{12}/
                );
                return Promise.resolve(items[0]);
            });
            execStub.callThrough();
            await vscode.commands.executeCommand('fossil.stashDrop');
            assert.ok(stashApply.calledOnce);
        });
        test('Pop', async () => {
            const repository = getRepository();
            const openedRepository: OpenedRepository = (repository as any)
                .repository;

            await openedRepository.exec([
                'stash',
                'save',
                '-m',
                'in test',
                'stash.txt',
            ]);
            const execStub = sandbox.stub(openedRepository, 'exec');
            const stashApply = execStub.withArgs(['stash', 'pop']);
            execStub.callThrough();
            await vscode.commands.executeCommand('fossil.stashPop');
            assert.ok(stashApply.calledOnce);
        });
        test('Snapshot', async () => {
            const repository = getRepository();
            const openedRepository: OpenedRepository = (repository as any)
                .repository;

            const execStub = sandbox.stub(openedRepository, 'exec');
            const stashSnapshot = execStub.withArgs([
                'stash',
                'snapshot',
                '-m',
                'stashSnapshot commit message',
                'stash.txt',
            ]);
            execStub.callThrough();
            const showInputBox = sandbox.stub(vscode.window, 'showInputBox');
            showInputBox.resolves('stashSnapshot commit message');

            const showWarningMessage: sinon.SinonStub = sandbox.stub(
                vscode.window,
                'showWarningMessage'
            );
            showWarningMessage.onFirstCall().resolves('C&&onfirm');

            await vscode.commands.executeCommand('fossil.stashSnapshot');
            assert.ok(stashSnapshot.calledOnce);
        });
    });
}

export function fossil_branch_suite(sandbox: sinon.SinonSandbox): void {
    suite('Branch', function (this: Suite) {
        test('Create public branch', async () => {
            const createInputBox = sandbox.stub(
                vscode.window,
                'createInputBox'
            );
            createInputBox.onFirstCall().callsFake(() => {
                const inputBox: vscode.InputBox =
                    createInputBox.wrappedMethod();
                const stub = sinon.stub(inputBox);
                stub.show.callsFake(() => {
                    stub.value = 'hello branch';
                    const onDidAccept = stub.onDidAccept.getCall(0).args[0];
                    const onDidChangeValue =
                        stub.onDidChangeValue.getCall(0).args[0];
                    const onDidTriggerButton =
                        stub.onDidTriggerButton.getCall(0).args[0];
                    onDidTriggerButton(stub.buttons[1]); // private on
                    onDidTriggerButton(stub.buttons[1]); // private off
                    onDidChangeValue(stub.value);
                    assert.equal(stub.validationMessage, '');
                    onDidAccept();
                });
                return stub;
            });

            const repository = getRepository();
            const openedRepository: OpenedRepository = (repository as any)
                .repository;

            const execStub = sandbox.stub(openedRepository, 'exec');
            execStub.callThrough();
            const creation = execStub
                .withArgs(['branch', 'new', 'hello branch', 'current'])
                .resolves();
            await vscode.commands.executeCommand('fossil.branch');
            assert.ok(creation.calledOnce);
        });
        test('Create private branch', async () => {
            const createInputBox = sandbox.stub(
                vscode.window,
                'createInputBox'
            );
            createInputBox.onFirstCall().callsFake(() => {
                const inputBox: vscode.InputBox =
                    createInputBox.wrappedMethod();
                const stub = sinon.stub(inputBox);
                stub.show.callsFake(() => {
                    stub.value = 'hello branch';
                    const onDidAccept = stub.onDidAccept.getCall(0).args[0];
                    const onDidTriggerButton =
                        stub.onDidTriggerButton.getCall(0).args[0];
                    onDidTriggerButton(stub.buttons[1]); // private on
                    onDidAccept();
                });
                return stub;
            });

            const repository = getRepository();
            const openedRepository: OpenedRepository = (repository as any)
                .repository;

            const execStub = sandbox.stub(openedRepository, 'exec');
            execStub.callThrough();
            const creation = execStub
                .withArgs([
                    'branch',
                    'new',
                    'hello branch',
                    'current',
                    '--private',
                ])
                .resolves();
            await vscode.commands.executeCommand('fossil.branch');
            assert.ok(creation.calledOnce);
        });
        test('Create branch with color', async () => {
            const createInputBox = sandbox.stub(
                vscode.window,
                'createInputBox'
            );
            createInputBox.onFirstCall().callsFake(() => {
                const inputBox: vscode.InputBox =
                    createInputBox.wrappedMethod();
                const stub = sinon.stub(inputBox);
                stub.show.callsFake(() => {
                    const onDidAccept = stub.onDidAccept.getCall(0).args[0];
                    const onDidTriggerButton =
                        stub.onDidTriggerButton.getCall(0).args[0];
                    onDidTriggerButton(stub.buttons[0]);
                    stub.value = '#aabbcc';
                    onDidAccept();
                    stub.value = 'color branch';
                    onDidAccept();
                });
                return stub;
            });

            const repository = getRepository();
            const openedRepository: OpenedRepository = (repository as any)
                .repository;

            const execStub = sandbox.stub(openedRepository, 'exec');
            execStub.callThrough();
            const creation = execStub
                .withArgs([
                    'branch',
                    'new',
                    'color branch',
                    'current',
                    '--bgcolor',
                    '#aabbcc',
                ])
                .resolves();
            await vscode.commands.executeCommand('fossil.branch');
            assert.ok(creation.calledOnce);
        });
    });
}

export function fossil_commit_suite(sandbox: sinon.SinonSandbox): void {
    suite('Commit', function (this: Suite) {
        test('Commit using input box', async () => {
            const repository = getRepository();
            const openedRepository: OpenedRepository = (repository as any)
                .repository;

            const execStub = sandbox
                .stub(openedRepository, 'exec')
                .callThrough();
            const statusStub = fakeFossilStatus(execStub, 'ADDED fake.txt\n');
            await repository.updateModelState();
            sinon.assert.calledOnce(statusStub);
            assert.equal(repository.workingGroup.resourceStates.length, 1);
            const commitStub = execStub
                .withArgs(['commit', 'fake.txt', '-m', 'non empty message'])
                .resolves(undefined);

            const showWarningMessage: sinon.SinonStub = sandbox.stub(
                vscode.window,
                'showWarningMessage'
            );
            showWarningMessage.onFirstCall().resolves('C&&onfirm');
            repository.sourceControl.inputBox.value = 'non empty message';
            await vscode.commands.executeCommand('fossil.commitWithInput');
            sinon.assert.calledOnceWithMatch(
                showWarningMessage,
                'There are no staged changes, do you want to commit working changes?\n'
            );
            sinon.assert.calledOnce(commitStub);
            assert.equal(repository.sourceControl.inputBox.value, '');
        });

        test('Commit nothing', async () => {
            const repository = getRepository();
            const openedRepository: OpenedRepository = (repository as any)
                .repository;

            const execStub = sandbox
                .stub(openedRepository, 'exec')
                .callThrough();
            const statusStub = fakeFossilStatus(execStub, '\n');
            await repository.updateModelState();
            sinon.assert.calledOnce(statusStub);
            assert.equal(repository.workingGroup.resourceStates.length, 0);

            const showInformationMessage: sinon.SinonStub = sandbox
                .stub(vscode.window, 'showInformationMessage')
                .resolves(undefined);
            repository.sourceControl.inputBox.value = 'non empty message';
            await vscode.commands.executeCommand('fossil.commitWithInput');
            sinon.assert.calledOnceWithMatch(
                showInformationMessage,
                'There are no changes to commit.'
            );
        });

        test('Commit empty message', async () => {
            const repository = getRepository();
            const openedRepository: OpenedRepository = (repository as any)
                .repository;
            const uri = vscode.Uri.joinPath(
                vscode.workspace.workspaceFolders![0].uri,
                'empty_commit.txt'
            );
            await fs.writeFile(uri.fsPath, 'content');

            const execStub = sandbox
                .stub(openedRepository, 'exec')
                .callThrough();
            await repository.updateModelState();
            const resource = repository.untrackedGroup.getResource(uri);
            //assert.equal(repository.untrackedGroup.resourceStates.length, 1);

            await vscode.commands.executeCommand('fossil.add', resource);
            assert.equal(repository.stagingGroup.resourceStates.length, 1);
            const commitStub = execStub.withArgs([
                'commit',
                'empty_commit.txt',
                '-m',
                '',
            ]);

            repository.sourceControl.inputBox.value = '';
            const showInputBoxstub = sandbox
                .stub(vscode.window, 'showInputBox')
                .resolves('Y');
            await vscode.commands.executeCommand('fossil.commitWithInput');
            sinon.assert.calledOnceWithMatch(showInputBoxstub, {
                prompt: 'empty check-in comment.  continue (y/N)? ',
                ignoreFocusOut: true,
            });
            sinon.assert.calledOnce(commitStub);
        });

        test('Commit creating new branch', async () => {
            const rootUri = vscode.workspace.workspaceFolders![0].uri;
            const branchPath = vscode.Uri.joinPath(rootUri, 'branch.txt');
            await fs.writeFile(branchPath.fsPath, 'branch content\n');

            const repository = getRepository();
            repository.sourceControl.inputBox.value = 'creating new branch';
            await repository.updateModelState();
            const resource = repository.untrackedGroup.getResource(branchPath);
            assert.ok(resource);
            await vscode.commands.executeCommand('fossil.add', resource);

            const createInputBox = sandbox.stub(
                vscode.window,
                'createInputBox'
            );
            createInputBox.onFirstCall().callsFake(() => {
                const inputBox: vscode.InputBox =
                    createInputBox.wrappedMethod();
                const stub = sinon.stub(inputBox);
                stub.show.callsFake(() => {
                    stub.value = 'commit branch';
                    const onDidAccept = stub.onDidAccept.getCall(0).args[0];
                    onDidAccept();
                });
                return stub;
            });

            const openedRepository: OpenedRepository = (repository as any)
                .repository;

            const execStub = sandbox.stub(openedRepository, 'exec');
            execStub.callThrough();
            const commitSub = execStub
                .withArgs([
                    'commit',
                    '--branch',
                    'commit branch',
                    'branch.txt',
                    '-m',
                    'creating new branch',
                ])
                .resolves();

            await vscode.commands.executeCommand('fossil.commitBranch');
            assert(commitSub.calledOnce);
        });

        test('Unsaved files warning', async () => {
            const uri1 = await add('warning1.txt', 'data', 'warning test');
            const uri2 = await add('warning2.txt', 'data', 'warning test');
            await fs.writeFile(uri1.fsPath, 'warning test');
            await fs.writeFile(uri2.fsPath, 'warning test');
            const repository = getRepository();
            await repository.updateModelState();
            const resource1 = repository.workingGroup.getResource(uri1);
            assert.ok(resource1);
            await vscode.commands.executeCommand('fossil.stage', resource1);
            await vscode.commands.executeCommand('fossil.openFiles', resource1);
            const editor1 = vscode.window.visibleTextEditors.find(
                e => e.document.uri.toString() == uri1.toString()
            );
            assert.ok(editor1);
            await editor1.edit(eb =>
                eb.insert(new vscode.Position(0, 0), 'edits\n')
            );
            repository.sourceControl.inputBox.value = 'my message';
            const showWarningMessage: sinon.SinonStub = sandbox.stub(
                vscode.window,
                'showWarningMessage'
            );
            showWarningMessage.onFirstCall().resolves(undefined);
            showWarningMessage.onSecondCall().resolves('Save All & Commit');

            await vscode.commands.executeCommand('fossil.commitWithInput');
            sinon.assert.calledWithExactly(
                showWarningMessage.firstCall,
                "The following file has unsaved changes which won't be included in the commit if you proceed: warning1.txt.\n\nWould you like to save it before committing?",
                { modal: true },
                'Save All & Commit',
                'C&&ommit Staged Changes'
            );

            const resource2 = repository.workingGroup.getResource(uri2);
            assert.ok(resource2);
            await vscode.commands.executeCommand('fossil.stage', resource2);
            await vscode.commands.executeCommand('fossil.openFiles', resource2);

            const editor2 = vscode.window.visibleTextEditors.find(
                e => e.document.uri.toString() == uri2.toString()
            );
            assert.ok(editor2);
            await editor2.edit(eb =>
                eb.insert(new vscode.Position(0, 0), 'edits\n')
            );

            await vscode.commands.executeCommand('fossil.commitWithInput');
            sinon.assert.calledWithExactly(
                showWarningMessage.secondCall,
                'There are 2 unsaved files.\n\nWould you like to save them before committing?',
                { modal: true },
                'Save All & Commit',
                'C&&ommit Staged Changes'
            );
        });
    });
}

export function fossil_merge_suite(sandbox: sinon.SinonSandbox): void {
    suite('Merge', function (this: Suite) {
        test('Integrate', async () => {
            const repository = getRepository();
            const openedRepository: OpenedRepository = (repository as any)
                .repository;
            await openedRepository.exec(['revert']);
            await openedRepository.exec(['clean']);
            await repository.updateModelState();
            const execStub = sandbox
                .stub(openedRepository, 'exec')
                .callThrough();
            execStub.withArgs(['branch', 'ls', '-t']).resolves({
                fossilPath: '',
                exitCode: 0,
                stdout: ' * a\n   b\n   c\n',
                stderr: '',
                args: ['status'],
                cwd: '',
            } as unknown as IExecutionResult);
            const mergeStub = execStub
                .withArgs(['merge', 'c', '--integrate'])
                .resolves();
            sandbox
                .stub(vscode.window, 'showQuickPick')
                .onFirstCall()
                .callsFake(items => {
                    assert.ok(items instanceof Array);
                    assert.equal(items[2].label, '$(git-branch) c');
                    return Promise.resolve(items[2]);
                });

            await vscode.commands.executeCommand('fossil.integrate');
            sinon.assert.calledOnce(mergeStub);
        });
        test('Cherrypick', async () => {
            const repository = getRepository();
            const openedRepository: OpenedRepository = (repository as any)
                .repository;
            const execStub = sandbox
                .stub(openedRepository, 'exec')
                .callThrough();
            let hash = '';
            const mergeCallStub = execStub
                .withArgs(sinon.match.array.startsWith(['merge']))
                .resolves();

            sandbox
                .stub(vscode.window, 'showQuickPick')
                .onFirstCall()
                .callsFake(items => {
                    assert.ok(items instanceof Array);
                    hash = (items[0] as unknown as { commit: { hash: string } })
                        .commit.hash;
                    assert.ok(hash);
                    return Promise.resolve(items[0]);
                });

            await vscode.commands.executeCommand('fossil.cherrypick');
            sinon.assert.calledOnceWithMatch(mergeCallStub, [
                'merge',
                hash,
                '--cherrypick',
            ]);
        });
    });
}

export function fossil_patch_suite(sandbox: sinon.SinonSandbox): void {
    suite('Patch', function (this: Suite) {
        test('Create', async () => {
            const patchPath = vscode.Uri.file('patch.patch');
            const showSaveDialogstub = sandbox
                .stub(vscode.window, 'showSaveDialog')
                .resolves(patchPath);

            const repository = getRepository();
            const openedRepository: OpenedRepository = (repository as any)
                .repository;
            const execStub = sandbox.stub(openedRepository, 'exec');
            const patchStub = execStub
                .withArgs(['patch', 'create', patchPath.fsPath])
                .resolves(undefined);
            execStub.callThrough();
            await vscode.commands.executeCommand('fossil.patchCreate');
            sinon.assert.calledOnceWithMatch(showSaveDialogstub, {
                saveLabel: 'Create',
                title: 'Create binary patch',
            });
            assert.ok(patchStub.calledOnce);
        });
        test('Apply', async () => {
            const patchPath = vscode.Uri.file('patch.patch');
            const showOpenDialogstub = sandbox
                .stub(vscode.window, 'showOpenDialog')
                .resolves([patchPath]);

            const repository = getRepository();
            const openedRepository: OpenedRepository = (repository as any)
                .repository;
            const execStub = sandbox.stub(openedRepository, 'exec');
            const patchStub = execStub
                .withArgs(['patch', 'apply', patchPath.fsPath])
                .resolves(undefined);
            execStub.callThrough();
            await vscode.commands.executeCommand('fossil.patchApply');
            sinon.assert.calledOnceWithMatch(showOpenDialogstub, {
                openLabel: 'Apply',
                title: 'Apply binary patch',
            });
            assert.ok(patchStub.calledOnce);
        });
    });
}

export function fossil_utilities_suite(sandbox: sinon.SinonSandbox): void {
    suite('Utility', function (this: Suite) {
        test('Show output', async () => {
            await vscode.commands.executeCommand('fossil.showOutput');
            // currently there is no way to validate fossil.showOutput
        });
        test('Open UI', async () => {
            const sendText = sinon.stub();
            const terminal = {
                sendText: sendText as unknown,
            } as vscode.Terminal;
            const createTerminalstub = sandbox
                .stub(vscode.window, 'createTerminal')
                .returns(terminal);
            await vscode.commands.executeCommand('fossil.openUI');
            sinon.assert.calledOnce(createTerminalstub);
            sinon.assert.calledOnceWithExactly(sendText, 'fossil ui', true);
        });
    });
}
