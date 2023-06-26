import * as vscode from 'vscode';
import { Uri, window, workspace, commands } from 'vscode';
import * as sinon from 'sinon';
import {
    add,
    assertGroups,
    cleanupFossil,
    fakeExecutionResult,
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
import { delay, eventToPromise } from '../../util';
import { Suite, Func, Test, before } from 'mocha';

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

export function RevertSuite(this: Suite): void {
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

        const showWarningMessage: sinon.SinonStub = this.ctx.sandbox.stub(
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
        const statusCall = fakeFossilStatus(execStub, fake_status.join('\n'));
        await repository.updateModelState();
        sinon.assert.calledOnce(statusCall);
        const resources = fileUris.map(uri => {
            const resource = repository.workingGroup.getResource(uri);
            assert.ok(resource);
            return resource;
        });
        const swm: sinon.SinonStub = this.ctx.sandbox.stub(
            window,
            'showWarningMessage'
        );
        await commands.executeCommand('fossil.revert', ...resources);
        assert.ok(
            swm.firstCall.calledWith(
                'Are you sure you want to discard changes to 14 files?\n\n • a\n • b\n • c\n • d\n • e\n • f\n • g\n • h\nand 6 others'
            )
        );
        await commands.executeCommand(
            'fossil.revert',
            ...resources.slice(0, 3)
        );
        assert.ok(
            swm.secondCall.calledWith(
                'Are you sure you want to discard changes to 3 files?\n\n • a\n • b\n • c'
            )
        );
    });

    test('Revert all', async () => {
        const swm: sinon.SinonStub = this.ctx.sandbox.stub(
            window,
            'showWarningMessage'
        );
        swm.onFirstCall().resolves('&&Discard Changes');

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
            swm,
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
}

export function BranchSuite(this: Suite): void {
    test('Create public branch', async () => {
        const cib = this.ctx.sandbox.stub(window, 'createInputBox');
        cib.onFirstCall().callsFake(() => {
            const inputBox: vscode.InputBox = cib.wrappedMethod();
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
        const cib = this.ctx.sandbox.stub(window, 'createInputBox');
        cib.onFirstCall().callsFake(() => {
            const inputBox: vscode.InputBox = cib.wrappedMethod();
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
            .withArgs(['branch', 'new', 'hello branch', 'current', '--private'])
            .resolves();
        await commands.executeCommand('fossil.branch');
        sinon.assert.calledOnce(creation);
    });

    test('Create branch with color', async () => {
        const cib = this.ctx.sandbox.stub(window, 'createInputBox');
        cib.onFirstCall().callsFake(() => {
            const inputBox: vscode.InputBox = cib.wrappedMethod();
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
}

export function MergeSuite(this: Suite): void {
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

        const sqp: sinon.SinonStub = this.ctx.sandbox.stub(
            window,
            'showQuickPick'
        );
        sqp.resolves({
            checkin: 'fossil-merge' as FossilBranch,
        });
        const sib = this.ctx.sandbox.stub(window, 'showInputBox');
        sib.resolves('test merge message');

        await commands.executeCommand('fossil.merge');
        sinon.assert.calledOnce(sqp);
        sinon.assert.calledOnce(sib);

        await repository.updateModelState('test');
        assertGroups(repository, new Map(), new Map());
    }).timeout(5000);

    test('Integrate', async () => {
        const repository = getRepository();
        await cleanupFossil(repository);
        const execStub = getExecStub(this.ctx.sandbox);
        execStub
            .withArgs(['branch', 'ls', '-t'])
            .resolves(fakeExecutionResult({ stdout: ' * a\n   b\n   c\n' }));
        fakeFossilStatus(execStub, 'INTEGRATE 0123456789');
        const mergeStub = execStub
            .withArgs(['merge', 'c', '--integrate'])
            .resolves();
        const commitStub = execStub
            .withArgs(sinon.match.array.startsWith(['commit']))
            .resolves();
        this.ctx.sandbox
            .stub(window, 'showQuickPick')
            .onFirstCall()
            .callsFake(items => {
                assert.ok(items instanceof Array);
                assert.equal(items[2].label, '$(git-branch) c');
                return Promise.resolve(items[2]);
            });
        const sim = this.ctx.sandbox.stub(window, 'showInformationMessage');
        const sib = this.ctx.sandbox
            .stub(window, 'showInputBox')
            .withArgs(sinon.match({ placeHolder: 'Commit message' }))
            .callsFake(options => Promise.resolve(options!.value));

        await commands.executeCommand('fossil.integrate');
        sinon.assert.notCalled(sim);
        sinon.assert.calledOnceWithExactly(sib, {
            value: 'Merge c into trunk',
            placeHolder: 'Commit message',
            prompt: 'Please provide a commit message',
            ignoreFocusOut: true,
        });
        sinon.assert.calledOnce(mergeStub);
        sinon.assert.calledOnceWithExactly(commitStub, [
            'commit',
            '-m',
            'Merge c into trunk',
        ]);
    }).timeout(5000);

    test('Cherrypick', async () => {
        const execStub = getExecStub(this.ctx.sandbox);
        execStub
            .withArgs(['branch', 'ls', '-t'])
            .resolves(fakeExecutionResult({ stdout: ' * a\n   b\n   c\n' }));
        fakeFossilStatus(execStub, '');
        const repository = getRepository();
        await repository.updateModelState();
        let hash = '';
        const mergeCallStub = execStub
            .withArgs(sinon.match.array.startsWith(['merge']))
            .resolves();

        this.ctx.sandbox
            .stub(window, 'showQuickPick')
            .onFirstCall()
            .callsFake(items => {
                assert.ok(items instanceof Array);
                hash = (items[0] as unknown as { commit: { hash: string } })
                    .commit.hash;
                assert.ok(hash);
                return Promise.resolve(items[0]);
            });
        const sim = this.ctx.sandbox
            .stub(window, 'showInformationMessage')
            .withArgs('There are no changes to commit.')
            .resolves();

        await commands.executeCommand('fossil.cherrypick');
        sinon.assert.calledOnceWithMatch(mergeCallStub, [
            'merge',
            hash,
            '--cherrypick',
        ]);
        sinon.assert.calledOnce(sim);
    });
}

export function StatusSuite(this: Suite): void {
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
        const oldUri = await add(oldFilename, 'test\n', `add ${oldFilename}`);
        await repository.updateModelState();
        assertGroups(repository, new Map(), new Map());

        const openedRepository: OpenedRepository = (repository as any)
            .repository;

        await openedRepository.exec(['mv', oldFilename, newFilename, '--hard']);
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
        const fooPath = (await add('foo-xa.txt', '', 'add: foo-xa.txt')).fsPath;

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
}

export function TagSuite(this: Suite): void {
    function selectTrunk(
        items:
            | readonly vscode.QuickPickItem[]
            | Thenable<readonly vscode.QuickPickItem[]>
    ) {
        assert.ok(items instanceof Array);
        const trunk = items.find(item => item.label === '$(git-branch) trunk');
        assert.ok(trunk);
        return Promise.resolve(trunk);
    }

    test('Close branch', async () => {
        const sqp = this.ctx.sandbox.stub(window, 'showQuickPick');
        sqp.onFirstCall().callsFake(selectTrunk);
        const tagCallStub = getExecStub(this.ctx.sandbox).withArgs(
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
        const sqp = this.ctx.sandbox.stub(window, 'showQuickPick');
        sqp.onFirstCall().callsFake(selectTrunk);
        const tagCallStub = getExecStub(this.ctx.sandbox).withArgs(
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
}

export function RenameSuite(this: Suite): void {
    before(async () => {
        const repository = getRepository();
        await cleanupFossil(repository);
    });

    test('Rename a file', async () => {
        const oldFilename = 'not_renamed.txt';
        const newFilename = 'renamed.txt';
        const rootUri = workspace.workspaceFolders![0].uri;
        await add(oldFilename, 'foo content\n', `add: ${oldFilename}`, 'ADDED');

        const sim: sinon.SinonStub = this.ctx.sandbox.stub(
            window,
            'showInformationMessage'
        );
        const answeredYes = sim.onFirstCall().resolves('Yes');

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
    }).timeout(6000);

    test("Don't show again", async () => {
        const config = () => workspace.getConfiguration('fossil');
        assert.equal(config().get('enableRenaming'), true, 'contract');
        const rootUri = workspace.workspaceFolders![0].uri;
        const execStub = getExecStub(this.ctx.sandbox);
        const oldFilename = 'do_not_show.txt';
        await fs.writeFile(Uri.joinPath(rootUri, oldFilename).fsPath, '123');
        const newFilename = 'test_failed.txt';

        const edit = new vscode.WorkspaceEdit();
        const newFilePath = Uri.joinPath(rootUri, newFilename);
        edit.renameFile(Uri.joinPath(rootUri, oldFilename), newFilePath);

        const sim = (
            this.ctx.sandbox.stub(
                window,
                'showInformationMessage'
            ) as sinon.SinonStub
        ).resolves("Don't show again");

        const status = await fakeFossilStatus(
            execStub,
            `EDITED ${oldFilename}\n`
        );
        const success = await workspace.applyEdit(edit);
        assert.ok(success);
        sinon.assert.calledOnceWithExactly(
            status,
            ['status', '--differ', '--merge'],
            'file rename event'
        );
        sinon.assert.calledOnceWithExactly(
            sim,
            '"do_not_show.txt" was renamed to "test_failed.txt" on ' +
                'filesystem. Rename in fossil repository too?',
            {
                modal: false,
            },
            'Yes',
            'Cancel',
            "Don't show again"
        );

        for (let i = 1; i < 100; ++i) {
            if (config().get('enableRenaming') === false) {
                break;
            }
            await delay(i * 11);
        }
        assert.equal(config().get('enableRenaming'), false, 'no update');
        await config().update('enableRenaming', true);
    }).timeout(3000);

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

        const sim: sinon.SinonStub = this.ctx.sandbox.stub(
            window,
            'showInformationMessage'
        );

        const answeredYes = sim.onFirstCall().resolves('Yes');

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
    }).timeout(10000);

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
        this.ctx.sandbox
            .stub(window, 'showQuickPick')
            .onFirstCall()
            .callsFake(items => {
                assert.ok(items instanceof Array);
                return Promise.resolve(items[0]);
            });

        const sod = this.ctx.sandbox
            .stub(window, 'showOpenDialog')
            .resolves([newUri]);
        await commands.executeCommand(
            'fossil.relocate',
            repository.workingGroup.resourceStates[0]
        );
        sinon.assert.calledOnce(sod);
        assertGroups(
            repository,
            new Map([[newUri.fsPath, ResourceStatus.RENAMED]]),
            new Map()
        );
    }).timeout(10000);
}

export function CleanSuite(this: Suite): void {
    test('Clean', async () => {
        const swm: sinon.SinonStub = this.ctx.sandbox.stub(
            window,
            'showWarningMessage'
        );
        swm.onFirstCall().resolves('&&Delete Extras');

        const execStub = getExecStub(this.ctx.sandbox);
        const cleanCallStub = execStub.withArgs(['clean']);
        await commands.executeCommand('fossil.clean');
        sinon.assert.calledOnce(cleanCallStub);
        sinon.assert.calledOnceWithExactly(
            swm,
            'Are you sure you want to delete untracked and unignored files?',
            { modal: true },
            '&&Delete Extras'
        );
    }).timeout(5000);

    test('Delete untracked files', async () => {
        const repository = getRepository();
        const execStub = getExecStub(this.ctx.sandbox);
        const cleanCallStub = execStub
            .withArgs(sinon.match.array.startsWith(['clean']))
            .resolves();
        await fakeFossilStatus(execStub, 'EXTRA a.txt\nEXTRA b.txt');
        await repository.updateModelState();
        assert.equal(repository.untrackedGroup.resourceStates.length, 2);
        const swm: sinon.SinonStub = this.ctx.sandbox.stub(
            window,
            'showWarningMessage'
        );
        swm.onFirstCall().resolves('&&Delete Files');

        await commands.executeCommand(
            'fossil.deleteFile',
            ...repository.untrackedGroup.resourceStates
        );
        sinon.assert.calledOnceWithExactly(
            swm,
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
        const execStub = getExecStub(this.ctx.sandbox);
        const cleanCallStub = execStub
            .withArgs(sinon.match.array.startsWith(['clean']))
            .resolves();
        await fakeFossilStatus(
            execStub,
            'EXTRA a.txt\nEXTRA b.txt\nEXTRA c.txt'
        );
        await repository.updateModelState();
        assert.equal(repository.untrackedGroup.resourceStates.length, 3);
        const showWarningMessage: sinon.SinonStub = this.ctx.sandbox.stub(
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
            'Are you sure you want to DELETE 3 files?\n' +
                'This is IRREVERSIBLE!\n' +
                'These files will be FOREVER LOST if you proceed.',
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
}
