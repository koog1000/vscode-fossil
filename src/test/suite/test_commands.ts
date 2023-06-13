import * as vscode from 'vscode';
import { Uri, window, workspace, commands } from 'vscode';
import * as sinon from 'sinon';
import {
    add,
    assertGroups,
    cleanupFossil,
    fakeFossilStatus,
    getExecStub,
    getRepository,
} from './common';
import * as assert from 'assert/strict';
import * as fs from 'fs/promises';
import {
    FossilBranch,
    OpenedRepository,
    ResourceStatus,
} from '../../openedRepository';
import { eventToPromise } from '../../util';
import { LineChange } from '../../revert';
import { Suite, beforeEach, Func, Test, before } from 'mocha';
import { IExecutionResult } from '../../fossilExecutable';

declare module 'mocha' {
    interface TestFunction {
        if: (condition: boolean, title: string, fn: Func) => Test;
    }
    interface Context {
        sandbox: sinon.SinonSandbox;
    }
}

test.if = function (condition: boolean, title: string, fn: Func): Test {
    if (condition) {
        return this(title, fn);
        /* c8 ignore next 3 */
    } else {
        return this.skip(title);
    }
};

export async function fossil_revert_change(): Promise<void> {
    const rootUri = workspace.workspaceFolders![0].uri;
    const filename = 'revert_change.txt';
    const uriToChange = Uri.joinPath(rootUri, filename);
    await commands.executeCommand('fossil.revertChange', uriToChange); // branch coverage

    const content = [...'abcdefghijklmnopqrstuvwxyz'].join('\n');
    await add(filename, content, `add '${filename}'`);
    const content2 = [...'abcdefghijklmn', 'typo', ...'opqrstuvwxyz'].join(
        '\n'
    );
    await fs.writeFile(uriToChange.fsPath, content2);

    const document = await workspace.openTextDocument(uriToChange);
    await window.showTextDocument(document);

    const line_change: LineChange = {
        modifiedEndLineNumber: 15,
        modifiedStartLineNumber: 15,
        originalEndLineNumber: 0,
        originalStartLineNumber: 14,
    };
    await commands.executeCommand(
        'fossil.revertChange',
        uriToChange,
        [line_change],
        0
    );
    const revertedContent = document.getText();
    assert.equal(revertedContent, content);
    await document.save();

    await commands.executeCommand('fossil.revertChange'); // better coverage
}

export async function fossil_pull_with_autoUpdate_on(
    sandbox: sinon.SinonSandbox
): Promise<void> {
    const execStub = getExecStub(sandbox);
    const sem = sandbox.stub(window, 'showErrorMessage').resolves();
    const updateCall = execStub.withArgs(['update']).resolves();
    await commands.executeCommand('fossil.pull');
    sinon.assert.notCalled(sem);
    sinon.assert.calledOnce(updateCall);
}

export async function fossil_pull_with_autoUpdate_off(
    sandbox: sinon.SinonSandbox
): Promise<void> {
    const fossilConfig = workspace.getConfiguration(
        'fossil',
        workspace.workspaceFolders![0].uri
    );
    const sem = sandbox.stub(window, 'showErrorMessage').resolves();
    await fossilConfig.update('autoUpdate', false);
    const execStub = getExecStub(sandbox);
    const pullCall = execStub.withArgs(['pull']).resolves();
    await commands.executeCommand('fossil.pull');
    sinon.assert.notCalled(sem);
    sinon.assert.calledOnce(pullCall);
    await fossilConfig.update('autoUpdate', true);
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
                window,
                'showWarningMessage'
            );
            showWarningMessage.onFirstCall().resolves('&&Discard Changes');

            await commands.executeCommand('fossil.revert', resource);
            const newContext = await fs.readFile(url.fsPath);
            assert.equal(newContext.toString('utf-8'), 'Some original text\n');
        });
        test('Dialog has no typos', async () => {
            const repository = getRepository();
            const rootUri = workspace.workspaceFolders![0].uri;
            const fake_status = [];
            const execStub = getExecStub(this.ctx.sandbox);
            const fileUris: Uri[] = [];
            for (const filename of 'abcdefghijklmn') {
                const fileUri = Uri.joinPath(rootUri, 'added', filename);
                fake_status.push(`EDITED     added/${filename}`);
                fileUris.push(fileUri);
            }
            const statusCall = fakeFossilStatus(
                execStub,
                fake_status.join('\n')
            );
            await repository.updateModelState();
            sinon.assert.calledOnce(statusCall);
            const resources = fileUris.map(uri => {
                const resource = repository.workingGroup.getResource(uri);
                assert.ok(resource);
                return resource;
            });
            const showWarningMessage: sinon.SinonStub = sandbox.stub(
                window,
                'showWarningMessage'
            );
            await commands.executeCommand('fossil.revert', ...resources);
            assert.ok(
                showWarningMessage.firstCall.calledWith(
                    'Are you sure you want to discard changes to 14 files?\n\n • a\n • b\n • c\n • d\n • e\n • f\n • g\n • h\nand 6 others'
                )
            );
            await commands.executeCommand(
                'fossil.revert',
                ...resources.slice(0, 3)
            );
            assert.ok(
                showWarningMessage.secondCall.calledWith(
                    'Are you sure you want to discard changes to 3 files?\n\n • a\n • b\n • c'
                )
            );
        });
        test('Revert all', async () => {
            const showWarningMessage: sinon.SinonStub = sandbox.stub(
                window,
                'showWarningMessage'
            );
            showWarningMessage.onFirstCall().resolves('&&Discard Changes');

            const repository = getRepository();
            const execStub = getExecStub(this.ctx.sandbox);
            const statusStub = fakeFossilStatus(
                execStub,
                'EDITED a.txt\nEDITED b.txt'
            );
            const revertStub = execStub
                .withArgs(sinon.match.array.startsWith(['revert']))
                .resolves();
            await repository.updateModelState();
            sinon.assert.calledOnce(statusStub);
            await commands.executeCommand('fossil.revertAll');
            sinon.assert.calledOnceWithExactly(
                showWarningMessage,
                'Are you sure you want to discard ALL changes?',
                { modal: true },
                '&&Discard Changes'
            );
            sinon.assert.calledOnceWithExactly(revertStub, [
                'revert',
                'a.txt',
                'b.txt',
            ]);
        });
    });
}

export async function fossil_change_branch_to_trunk(
    sandbox: sinon.SinonSandbox
): Promise<void> {
    const execStub = getExecStub(sandbox);
    const updateCall = execStub.withArgs(['update', 'trunk']).resolves();

    const showQuickPick = sandbox.stub(window, 'showQuickPick');
    showQuickPick.onFirstCall().callsFake(items => {
        assert.ok(items instanceof Array);
        assert.equal(items[2].label, '$(git-branch) trunk');
        return Promise.resolve(items[2]);
    });

    await commands.executeCommand('fossil.branchChange');

    sinon.assert.calledOnce(updateCall);
}

export async function fossil_change_branch_to_hash(
    sandbox: sinon.SinonSandbox
): Promise<void> {
    const repository = getRepository();
    await cleanupFossil(repository);
    const execStub = getExecStub(sandbox);
    const updateCall = execStub.withArgs(['update', '1234567890']).resolves();

    const showQuickPick = sandbox.stub(window, 'showQuickPick');
    showQuickPick.onFirstCall().callsFake(items => {
        assert.ok(items instanceof Array);
        assert.equal(items[0].label, '$(pencil) Checkout by hash');
        return Promise.resolve(items[0]);
    });
    const showInputBox = sandbox.stub(window, 'showInputBox');
    showInputBox.onFirstCall().resolves('1234567890');
    await commands.executeCommand('fossil.branchChange');

    sinon.assert.calledOnce(showInputBox);
    sinon.assert.calledOnce(updateCall);
}

export function fossil_stash_suite(): void {
    suite('Stash', function (this: Suite) {
        test('Save', async () => {
            const repository = getRepository();
            const uri = Uri.joinPath(
                workspace.workspaceFolders![0].uri,
                'stash.txt'
            );
            await fs.writeFile(uri.fsPath, 'stash me');

            const siw = this.ctx.sandbox.stub(window, 'showInputBox');
            siw.onFirstCall().resolves('stashSave commit message');

            const stashSave = getExecStub(this.ctx.sandbox).withArgs([
                'stash',
                'save',
                '-m',
                'stashSave commit message',
                'stash.txt',
            ]);
            await repository.updateModelState();
            const resource = repository.untrackedGroup.getResource(uri);
            assert.ok(resource);
            await commands.executeCommand('fossil.add', resource);
            await commands.executeCommand('fossil.stashSave');
            sinon.assert.calledOnce(stashSave);
        });
        test('Apply', async () => {
            const execStub = getExecStub(this.ctx.sandbox);
            const stashApply = execStub.withArgs(['stash', 'apply', '1']);
            const sqp = this.ctx.sandbox.stub(window, 'showQuickPick');
            sqp.onFirstCall().callsFake(items => {
                assert.ok(items instanceof Array);
                assert.match(
                    items[0].label,
                    /\$\(circle-outline\) 1 • [a-f0-9]{12}/
                );
                return Promise.resolve(items[0]);
            });
            await commands.executeCommand('fossil.stashApply');
            sinon.assert.calledOnce(stashApply);
        });
        test('Drop', async () => {
            const execStub = getExecStub(this.ctx.sandbox);
            const stashApply = execStub.withArgs(['stash', 'drop', '1']);
            const sqp = this.ctx.sandbox.stub(window, 'showQuickPick');
            sqp.onFirstCall().callsFake(items => {
                assert.ok(items instanceof Array);
                assert.match(
                    items[0].label,
                    /\$\(circle-outline\) 1 • [a-f0-9]{12}/
                );
                return Promise.resolve(items[0]);
            });
            await commands.executeCommand('fossil.stashDrop');
            sinon.assert.calledOnce(stashApply);
        });
        test('Pop', async () => {
            const execStub = getExecStub(this.ctx.sandbox);
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
            const stashPop = execStub.withArgs(['stash', 'pop']);
            await commands.executeCommand('fossil.stashPop');
            sinon.assert.calledOnce(stashPop);
        });
        test('Snapshot', async () => {
            const execStub = getExecStub(this.ctx.sandbox);
            const stashSnapshot = execStub.withArgs([
                'stash',
                'snapshot',
                '-m',
                'stashSnapshot commit message',
                'stash.txt',
            ]);
            const sib = this.ctx.sandbox.stub(window, 'showInputBox');
            sib.resolves('stashSnapshot commit message');

            const swm: sinon.SinonStub = this.ctx.sandbox.stub(
                window,
                'showWarningMessage'
            );
            swm.onFirstCall().resolves('C&&onfirm');

            await commands.executeCommand('fossil.stashSnapshot');
            sinon.assert.calledOnce(stashSnapshot);
        });
    });
}

export function fossil_branch_suite(sandbox: sinon.SinonSandbox): void {
    suite('Branch', function (this: Suite) {
        test('Create public branch', async () => {
            const createInputBox = sandbox.stub(window, 'createInputBox');
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

            const creation = getExecStub(this.ctx.sandbox)
                .withArgs(['branch', 'new', 'hello branch', 'current'])
                .resolves();
            await commands.executeCommand('fossil.branch');
            sinon.assert.calledOnce(creation);
        });
        test('Create private branch', async () => {
            const createInputBox = sandbox.stub(window, 'createInputBox');
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

            const execStub = getExecStub(this.ctx.sandbox);
            const creation = execStub
                .withArgs([
                    'branch',
                    'new',
                    'hello branch',
                    'current',
                    '--private',
                ])
                .resolves();
            await commands.executeCommand('fossil.branch');
            sinon.assert.calledOnce(creation);
        });
        test('Create branch with color', async () => {
            const createInputBox = sandbox.stub(window, 'createInputBox');
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
            const execStub = getExecStub(this.ctx.sandbox);
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
            await commands.executeCommand('fossil.branch');
            sinon.assert.calledOnce(creation);
        });
    });
}

export function fossil_merge_suite(sandbox: sinon.SinonSandbox): void {
    suite('Merge', function (this: Suite) {
        test('Merge', async () => {
            const repository = getRepository();
            const openedRepository: OpenedRepository = (repository as any)
                .repository;

            const fooFilename = 'foo-merge.txt';
            const barFilename = 'bar-merge.txt';
            const rootUri = workspace.workspaceFolders![0].uri;
            const fooPath = Uri.joinPath(rootUri, fooFilename).fsPath;
            await fs.writeFile(fooPath, 'foo content\n');
            await openedRepository.exec(['add', fooFilename]);
            await openedRepository.exec([
                'commit',
                '-m',
                `add: ${fooFilename}`,
                '--no-warnings',
            ]);
            const barPath = Uri.joinPath(rootUri, fooFilename).fsPath;
            await fs.writeFile(barPath, 'bar content\n');
            await openedRepository.exec(['add', barFilename]);
            await fs.appendFile(fooPath, 'foo content 2\n');
            await openedRepository.exec([
                'commit',
                '-m',
                `add: ${barFilename}; mod`,
                '--no-warnings',
                '--branch',
                'fossil-merge',
            ]);
            await openedRepository.exec(['update', 'trunk']);

            await commands.executeCommand('fossil.refresh');
            await repository.updateModelState();
            assertGroups(repository, new Map(), new Map());

            const showQuickPickstub = sandbox.stub(
                window,
                'showQuickPick'
            ) as sinon.SinonStub;
            showQuickPickstub.resolves({
                checkin: 'fossil-merge' as FossilBranch,
            });
            const showInputBoxstub = sandbox.stub(window, 'showInputBox');
            showInputBoxstub.resolves('test merge message');

            await commands.executeCommand('fossil.merge');
            sinon.assert.calledOnce(showQuickPickstub);
            sinon.assert.calledOnce(showInputBoxstub);

            await repository.updateModelState();
            assertGroups(repository, new Map(), new Map());
        });
        test('Integrate', async () => {
            const repository = getRepository();
            await cleanupFossil(repository);
            const execStub = getExecStub(this.ctx.sandbox);
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
                .stub(window, 'showQuickPick')
                .onFirstCall()
                .callsFake(items => {
                    assert.ok(items instanceof Array);
                    assert.equal(items[2].label, '$(git-branch) c');
                    return Promise.resolve(items[2]);
                });

            await commands.executeCommand('fossil.integrate');
            sinon.assert.calledOnce(mergeStub);
        });
        test('Cherrypick', async () => {
            let hash = '';
            const mergeCallStub = getExecStub(sandbox)
                .withArgs(sinon.match.array.startsWith(['merge']))
                .resolves();

            sandbox
                .stub(window, 'showQuickPick')
                .onFirstCall()
                .callsFake(items => {
                    assert.ok(items instanceof Array);
                    hash = (items[0] as unknown as { commit: { hash: string } })
                        .commit.hash;
                    assert.ok(hash);
                    return Promise.resolve(items[0]);
                });

            await commands.executeCommand('fossil.cherrypick');
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
            const patchPath = Uri.file('patch.patch');
            const showSaveDialogstub = sandbox
                .stub(window, 'showSaveDialog')
                .resolves(patchPath);

            const patchStub = getExecStub(this.ctx.sandbox)
                .withArgs(['patch', 'create', patchPath.fsPath])
                .resolves();
            await commands.executeCommand('fossil.patchCreate');
            sinon.assert.calledOnceWithMatch(showSaveDialogstub, {
                saveLabel: 'Create',
                title: 'Create binary patch',
            });
            sinon.assert.calledOnce(patchStub);
        });
        test('Apply', async () => {
            const patchPath = Uri.file('patch.patch');
            const showOpenDialogstub = sandbox
                .stub(window, 'showOpenDialog')
                .resolves([patchPath]);

            const patchStub = getExecStub(this.ctx.sandbox)
                .withArgs(['patch', 'apply', patchPath.fsPath])
                .resolves();
            await commands.executeCommand('fossil.patchApply');
            sinon.assert.calledOnceWithMatch(showOpenDialogstub, {
                openLabel: 'Apply',
                title: 'Apply binary patch',
            });
            sinon.assert.calledOnce(patchStub);
        });
    });
}

export function fossil_status_suite(): void {
    suite('Status', function (this: Suite) {
        test('Missing is visible in Source Control panel', async () => {
            const filename = 'smiviscp.txt';
            const path = await add(
                'smiviscp.txt',
                'test\n',
                `ADDED  ${filename}\n`
            );
            await fs.unlink(path.fsPath);
            const repository = getRepository();
            await repository.updateModelState();
            assertGroups(
                repository,
                new Map([[path.fsPath, ResourceStatus.MISSING]]),
                new Map()
            );
        }).timeout(5000);

        test('Rename is visible in Source Control panel', async () => {
            const repository = getRepository();
            await cleanupFossil(repository);
            const oldFilename = 'sriciscp-new.txt';
            const newFilename = 'sriciscp-renamed.txt';
            const oldUri = await add(
                oldFilename,
                'test\n',
                `add ${oldFilename}`
            );
            await repository.updateModelState();
            assertGroups(repository, new Map(), new Map());

            const openedRepository: OpenedRepository = (repository as any)
                .repository;

            await openedRepository.exec([
                'mv',
                oldFilename,
                newFilename,
                '--hard',
            ]);
            await repository.updateModelState();
            const barPath = Uri.joinPath(oldUri, '..', newFilename).fsPath;
            assertGroups(
                repository,
                new Map([[barPath, ResourceStatus.RENAMED]]),
                new Map()
            );
        }).timeout(15000);

        test('Merge is visible in Source Control panel', async () => {
            const repository = getRepository();
            await cleanupFossil(repository);
            const openedRepository: OpenedRepository = (repository as any)
                .repository;

            const rootUri = workspace.workspaceFolders![0].uri;
            const fooPath = (await add('foo-xa.txt', '', 'add: foo-xa.txt'))
                .fsPath;

            const barPath = Uri.joinPath(rootUri, 'bar-xa.txt').fsPath;
            await fs.writeFile(barPath, 'test bar\n');
            await fs.appendFile(fooPath, 'appended\n');
            await openedRepository.exec(['add', 'bar-xa.txt']);
            await openedRepository.exec([
                'commit',
                '-m',
                'add: bar-xa.txt, mod foo-xa.txt',
                '--branch',
                'test_brunch',
                '--no-warnings',
            ]);

            await openedRepository.exec(['update', 'trunk']);
            await openedRepository.exec(['merge', 'test_brunch']);
            await repository.updateModelState();
            assertGroups(
                repository,
                new Map([
                    [barPath, ResourceStatus.ADDED],
                    [fooPath, ResourceStatus.MODIFIED],
                ]),
                new Map()
            );
        }).timeout(10000);

        test.if(process.platform != 'win32', 'Meta', async () => {
            const uri = workspace.workspaceFolders![0].uri;

            // enable symlinks
            const repository = getRepository();
            const openedRepository: OpenedRepository = (repository as any)
                .repository;
            await openedRepository.exec(['settings', 'allow-symlinks', 'on']);

            await cleanupFossil(repository);

            // EXECUTABLE
            const executable_path = Uri.joinPath(uri, 'executable').fsPath;
            await fs.writeFile(executable_path, 'executable_path');
            await openedRepository.exec(['add', executable_path]);
            await openedRepository.exec([
                'commit',
                executable_path,
                '-m',
                'added executable',
            ]);
            await fs.chmod(executable_path, 0o744);

            // UNEXEC
            const unexec_path = Uri.joinPath(uri, 'status_unexec').fsPath;
            await fs.writeFile(unexec_path, 'unexec_path');
            await fs.chmod(unexec_path, 0o744);
            await openedRepository.exec(['add', unexec_path]);
            await openedRepository.exec([
                'commit',
                unexec_path,
                '-m',
                'added status_unexec',
            ]);
            await fs.chmod(unexec_path, 0o644);

            // SYMLINK
            const symlink_path = Uri.joinPath(uri, 'symlink').fsPath;
            await fs.writeFile(symlink_path, 'symlink_path');
            await openedRepository.exec(['add', symlink_path]);
            await openedRepository.exec([
                'commit',
                symlink_path,
                '-m',
                'added symlink',
            ]);
            await fs.unlink(symlink_path);
            await fs.symlink('/etc/passwd', symlink_path);

            // UNLINK
            const unlink_path = Uri.joinPath(uri, 'unlink').fsPath;
            await fs.symlink('/etc/passwd', unlink_path);
            await openedRepository.exec(['add', unlink_path]);
            await openedRepository.exec([
                'commit',
                unlink_path,
                '-m',
                'added unlink',
            ]);
            await fs.rm(unlink_path);
            await fs.writeFile(unlink_path, '/etc/passwd');

            // NOT A FILE
            const not_file_path = Uri.joinPath(uri, 'not_file').fsPath;
            await fs.writeFile(not_file_path, 'not_file_path');
            await openedRepository.exec(['add', not_file_path]);
            await openedRepository.exec([
                'commit',
                not_file_path,
                '-m',
                'added not_file',
            ]);
            await fs.unlink(not_file_path);
            await fs.mkdir(not_file_path);

            await repository.updateModelState();
            assertGroups(
                repository,
                new Map([
                    [executable_path, ResourceStatus.MODIFIED],
                    [unexec_path, ResourceStatus.MODIFIED],
                    [symlink_path, ResourceStatus.MODIFIED],
                    [unlink_path, ResourceStatus.MODIFIED],
                    [not_file_path, ResourceStatus.MISSING],
                ]),
                new Map()
            );
            new Map();
            await fs.rmdir(not_file_path);
        }).timeout(20000);
    });
}

export function fossil_stage_suite(sandbox: sinon.SinonSandbox): void {
    suite('Stage', function (this: Suite) {
        before(async () => {
            const repository = getRepository();
            await cleanupFossil(repository);
        });
        async function statusSetup(status: string) {
            const execStub = getExecStub(sandbox);
            await fakeFossilStatus(execStub, status);
            const repository = getRepository();
            await repository.updateModelState();
        }

        test('Stage from working group', async () => {
            await commands.executeCommand('fossil.unstageAll');
            await statusSetup('ADDED a.txt\nEDITED b.txt\nEDITED c.txt');
            const repository = getRepository();
            assert.equal(repository.workingGroup.resourceStates.length, 3);
            assert.equal(repository.stagingGroup.resourceStates.length, 0);
            await commands.executeCommand(
                'fossil.stage',
                repository.workingGroup.resourceStates[0],
                repository.workingGroup.resourceStates[1]
            );
            assert.equal(repository.workingGroup.resourceStates.length, 1);
            assert.equal(repository.stagingGroup.resourceStates.length, 2);
        });
        test('Stage all', async () => {
            await commands.executeCommand('fossil.unstageAll');
            await statusSetup('ADDED a.txt\nEDITED b.txt\nEDITED c.txt');
            const repository = getRepository();
            assert.equal(repository.workingGroup.resourceStates.length, 3);
            assert.equal(repository.stagingGroup.resourceStates.length, 0);
            await commands.executeCommand('fossil.stageAll');
            assert.equal(repository.workingGroup.resourceStates.length, 0);
            assert.equal(repository.stagingGroup.resourceStates.length, 3);
        });
        test('Unstage', async () => {
            const repository = getRepository();
            await commands.executeCommand('fossil.unstageAll');
            assert.equal(repository.stagingGroup.resourceStates.length, 0);
            await statusSetup('ADDED a.txt\nEDITED b.txt\nEDITED c.txt');
            assert.equal(repository.workingGroup.resourceStates.length, 3);
            assert.equal(repository.stagingGroup.resourceStates.length, 0);
            await commands.executeCommand('fossil.stageAll');
            assert.equal(repository.workingGroup.resourceStates.length, 0);
            assert.equal(repository.stagingGroup.resourceStates.length, 3);
            await commands.executeCommand(
                'fossil.unstage',
                repository.stagingGroup.resourceStates[1]
            );
            assert.equal(repository.workingGroup.resourceStates.length, 1);
            assert.equal(repository.stagingGroup.resourceStates.length, 2);
        });
    });
}

export function fossil_tag_suite(sandbox: sinon.SinonSandbox): void {
    suite('Tag', function (this: Suite) {
        test('Close branch', async () => {
            const showQuickPick = sandbox.stub(window, 'showQuickPick');
            showQuickPick.onFirstCall().callsFake(items => {
                assert.ok(items instanceof Array);
                assert.equal(items[0].label, '$(git-branch) trunk');
                return Promise.resolve(items[0]);
            });
            const execStub = getExecStub(sandbox);
            const tagCallStub = execStub.withArgs(
                sinon.match.array.startsWith(['tag'])
            );
            await commands.executeCommand('fossil.closeBranch');
            sinon.assert.calledOnceWithExactly(tagCallStub, [
                'tag',
                'add',
                '--raw',
                'closed',
                'trunk',
            ]);
        });
        test('Reopen branch', async () => {
            const showQuickPick = sandbox.stub(window, 'showQuickPick');
            showQuickPick.onFirstCall().callsFake(items => {
                assert.ok(items instanceof Array);
                assert.equal(items[0].label, '$(git-branch) trunk');
                return Promise.resolve(items[0]);
            });
            const execStub = getExecStub(sandbox);
            const tagCallStub = execStub.withArgs(
                sinon.match.array.startsWith(['tag'])
            );
            await commands.executeCommand('fossil.reopenBranch');
            sinon.assert.calledOnceWithExactly(tagCallStub, [
                'tag',
                'cancel',
                '--raw',
                'closed',
                'trunk',
            ]);
        });
    });
}

export function fossil_rename_suite(sandbox: sinon.SinonSandbox): void {
    suite('Rename', function (this: Suite) {
        before(async () => {
            const repository = getRepository();
            await cleanupFossil(repository);
        });
        beforeEach(() => {
            sandbox.restore();
        });

        test('Rename a file', async () => {
            const oldFilename = 'not_renamed.txt';
            const newFilename = 'renamed.txt';
            const rootUri = workspace.workspaceFolders![0].uri;
            await add(
                oldFilename,
                'foo content\n',
                `add: ${oldFilename}`,
                'ADDED'
            );

            const showInformationMessage: sinon.SinonStub = sandbox.stub(
                window,
                'showInformationMessage'
            );
            const answeredYes = showInformationMessage
                .onFirstCall()
                .resolves('Yes');

            const edit = new vscode.WorkspaceEdit();
            const newFilePath = Uri.joinPath(rootUri, newFilename);
            edit.renameFile(Uri.joinPath(rootUri, oldFilename), newFilePath);

            const success = await workspace.applyEdit(edit);
            assert.ok(success);

            const repository = getRepository();
            await answeredYes;
            await eventToPromise(repository.onDidRunOperation);
            await repository.updateModelState();

            assertGroups(
                repository,
                new Map([[newFilePath.fsPath, ResourceStatus.RENAMED]]),
                new Map()
            );
        });

        test('Rename directory', async () => {
            const oldDirname = 'not_renamed';
            const newDirname = 'renamed';
            const rootUri = workspace.workspaceFolders![0].uri;
            const oldDirUrl = Uri.joinPath(rootUri, oldDirname);
            const newDirUrl = Uri.joinPath(rootUri, newDirname);
            await fs.mkdir(oldDirUrl.fsPath);
            const filenames = ['mud', 'cabbage', 'brick'];
            const oldUris = filenames.map(filename =>
                Uri.joinPath(oldDirUrl, filename)
            );
            const newUris = filenames.map(filename =>
                Uri.joinPath(newDirUrl, filename)
            );

            await Promise.all(
                oldUris.map(uri => fs.writeFile(uri.fsPath, `foo ${uri}\n`))
            );
            const repository = getRepository();
            const openedRepository: OpenedRepository = (repository as any)
                .repository;
            await openedRepository.exec(['add', oldDirname]);
            await openedRepository.exec([
                'commit',
                '-m',
                `add directory: ${oldDirname}`,
                '--no-warnings',
            ]);

            const showInformationMessage: sinon.SinonStub = sandbox.stub(
                window,
                'showInformationMessage'
            );

            const answeredYes = showInformationMessage
                .onFirstCall()
                .resolves('Yes');

            const edit = new vscode.WorkspaceEdit();
            edit.renameFile(oldDirUrl, newDirUrl);

            const success = await workspace.applyEdit(edit);
            assert.ok(success);

            await answeredYes;
            await eventToPromise(repository.onDidRunOperation);
            await repository.updateModelState();

            const ref: [string, ResourceStatus][] = newUris.map((url: Uri) => [
                url.fsPath,
                ResourceStatus.RENAMED,
            ]);
            assertGroups(repository, new Map(ref), new Map());
        });

        test('Relocate', async () => {
            const repository = getRepository();
            await cleanupFossil(repository);
            const oldFilename = 'not_relocated.txt';
            const newFilename = 'relocated.txt';
            const rootUri = workspace.workspaceFolders![0].uri;
            const newUri = Uri.joinPath(rootUri, newFilename);
            const oldUri = await add(
                oldFilename,
                'foo content\n',
                `add: ${oldFilename}`,
                'ADDED'
            );
            await fs.rename(oldUri.fsPath, newUri.fsPath);
            await repository.updateModelState();
            assertGroups(
                repository,
                new Map([[oldUri.fsPath, ResourceStatus.MISSING]]),
                new Map()
            );
            sandbox
                .stub(window, 'showQuickPick')
                .onFirstCall()
                .callsFake(items => {
                    assert.ok(items instanceof Array);
                    return Promise.resolve(items[0]);
                });

            const showOpenDialogstub = sandbox
                .stub(window, 'showOpenDialog')
                .resolves([newUri]);
            await commands.executeCommand(
                'fossil.relocate',
                repository.workingGroup.resourceStates[0]
            );
            sinon.assert.calledOnce(showOpenDialogstub);
            assertGroups(
                repository,
                new Map([[newUri.fsPath, ResourceStatus.RENAMED]]),
                new Map()
            );
        }).timeout(10000);
    });
}

export function fossil_clean_suite(sandbox: sinon.SinonSandbox): void {
    suite('Clean', function (this: Suite) {
        test('Clean', async () => {
            const showWarningMessage: sinon.SinonStub = sandbox.stub(
                window,
                'showWarningMessage'
            );
            showWarningMessage.onFirstCall().resolves('&&Delete Extras');

            const execStub = getExecStub(sandbox);
            const cleanCallStub = execStub.withArgs(['clean']);
            await commands.executeCommand('fossil.clean');
            sinon.assert.calledOnce(cleanCallStub);
            sinon.assert.calledOnceWithExactly(
                showWarningMessage,
                'Are you sure you want to delete untracked and unignored files?',
                { modal: true },
                '&&Delete Extras'
            );
        }).timeout(5000);
        test('Delete untracked files', async () => {
            const repository = getRepository();
            const execStub = getExecStub(sandbox);
            const cleanCallStub = execStub
                .withArgs(sinon.match.array.startsWith(['clean']))
                .resolves();
            await fakeFossilStatus(execStub, 'EXTRA a.txt\nEXTRA b.txt');
            await repository.updateModelState();
            assert.equal(repository.untrackedGroup.resourceStates.length, 2);
            const showWarningMessage: sinon.SinonStub = sandbox.stub(
                window,
                'showWarningMessage'
            );
            showWarningMessage.onFirstCall().resolves('&&Delete Files');

            await commands.executeCommand(
                'fossil.deleteFile',
                ...repository.untrackedGroup.resourceStates
            );
            sinon.assert.calledOnceWithExactly(
                showWarningMessage,
                'Are you sure you want to DELETE 2 files?\nThis is IRREVERSIBLE!\nThese files will be FOREVER LOST if you proceed.',
                { modal: true },
                '&&Delete Files'
            );
            sinon.assert.calledOnceWithExactly;
            sinon.assert.calledOnceWithMatch(cleanCallStub, [
                'clean',
                ...repository.untrackedGroup.resourceStates.map(
                    r => r.resourceUri.fsPath
                ),
            ]);
        }).timeout(5000);
        test('Delete All Untracked Files', async () => {
            const repository = getRepository();
            const execStub = getExecStub(sandbox);
            const cleanCallStub = execStub
                .withArgs(sinon.match.array.startsWith(['clean']))
                .resolves();
            await fakeFossilStatus(
                execStub,
                'EXTRA a.txt\nEXTRA b.txt\nEXTRA c.txt'
            );
            await repository.updateModelState();
            assert.equal(repository.untrackedGroup.resourceStates.length, 3);
            const showWarningMessage: sinon.SinonStub = sandbox.stub(
                window,
                'showWarningMessage'
            );
            showWarningMessage.onFirstCall().resolves('&&Delete Files');

            await commands.executeCommand(
                'fossil.deleteFiles',
                repository.untrackedGroup
            );
            sinon.assert.calledOnceWithExactly(
                showWarningMessage,
                'Are you sure you want to DELETE 3 files?\nThis is IRREVERSIBLE!\nThese files will be FOREVER LOST if you proceed.',
                { modal: true },
                '&&Delete Files'
            );
            sinon.assert.calledOnceWithExactly;
            sinon.assert.calledOnceWithMatch(cleanCallStub, [
                'clean',
                ...repository.untrackedGroup.resourceStates.map(
                    r => r.resourceUri.fsPath
                ),
            ]);
        }).timeout(5000);
    });
}
