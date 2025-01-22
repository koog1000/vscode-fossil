import * as vscode from 'vscode';
import { Uri, window, workspace, commands } from 'vscode';
import * as sinon from 'sinon';
import {
    add,
    assertGroups,
    cleanupFossil,
    fakeExecutionResult,
    fakeFossilBranch,
    fakeFossilChanges,
    fakeFossilStatus,
    fakeRawExecutionResult,
    fakeStatusResult,
    getExecStub,
    getRawExecStub,
    getRepository,
    statusBarCommands,
} from './common';
import * as assert from 'assert/strict';
import * as fs from 'fs/promises';
import {
    FossilBranch,
    FossilCheckin,
    FossilCommitMessage,
    FossilTag,
    OpenedRepository,
    RelativePath,
    ResourceStatus,
} from '../../openedRepository';
import { Suite, before, Func, Test } from 'mocha';
import { toFossilUri } from '../../uri';
import { Reason } from '../../fossilExecutable';

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
        await repository.updateStatus('Test' as Reason);
        assertGroups(repository, {
            working: [[path.fsPath, ResourceStatus.MISSING]],
        });
    }).timeout(5000);

    test('Rename is visible in Source Control panel', async () => {
        const repository = getRepository();
        await cleanupFossil(repository);
        const oldFilename = 'sriciscp-new.txt' as RelativePath;
        const newFilename = 'sriciscp-renamed.txt' as RelativePath;
        const oldUri = await add(oldFilename, 'test\n', `add ${oldFilename}`);
        await repository.updateStatus('Test' as Reason);
        assertGroups(repository, {});

        const openedRepository: OpenedRepository = (repository as any)
            .repository;

        await openedRepository.exec(['mv', oldFilename, newFilename, '--hard']);
        await repository.updateStatus('Test' as Reason);
        const barPath = Uri.joinPath(oldUri, '..', newFilename).fsPath;
        assertGroups(repository, {
            working: [[barPath, ResourceStatus.RENAMED]],
        });
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
        await openedRepository.exec(['add', 'bar-xa.txt' as RelativePath]);
        await openedRepository.exec([
            'commit',
            '-m',
            'add: bar-xa.txt, mod foo-xa.txt' as FossilCommitMessage,
            '--branch',
            'test_brunch' as FossilBranch,
            '--no-warnings',
        ]);

        await openedRepository.exec(['update', 'trunk' as FossilBranch]);
        await openedRepository.exec(['merge', 'test_brunch' as FossilCheckin]);
        await repository.updateStatus('Test' as Reason);
        assertGroups(repository, {
            working: [
                [barPath, ResourceStatus.ADDED],
                [fooPath, ResourceStatus.MODIFIED],
            ],
        });
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
        await openedRepository.exec(['add', executable_path as RelativePath]);
        await openedRepository.exec([
            'commit',
            executable_path as RelativePath,
            '-m',
            'added executable' as FossilCommitMessage,
        ]);
        await fs.chmod(executable_path, 0o744);

        // UNEXEC
        const unexec_path = Uri.joinPath(uri, 'status_unexec').fsPath;
        await fs.writeFile(unexec_path, 'unexec_path');
        await fs.chmod(unexec_path, 0o744);
        await openedRepository.exec(['add', unexec_path as RelativePath]);
        await openedRepository.exec([
            'commit',
            unexec_path as RelativePath,
            '-m',
            'added status_unexec' as FossilCommitMessage,
        ]);
        await fs.chmod(unexec_path, 0o644);

        // SYMLINK
        const symlink_path = Uri.joinPath(uri, 'symlink').fsPath;
        await fs.writeFile(symlink_path, 'symlink_path');
        await openedRepository.exec(['add', symlink_path as RelativePath]);
        await openedRepository.exec([
            'commit',
            symlink_path as RelativePath,
            '-m',
            'added symlink' as FossilCommitMessage,
        ]);
        await fs.unlink(symlink_path);
        await fs.symlink('/etc/passwd', symlink_path);

        // UNLINK
        const unlink_path = Uri.joinPath(uri, 'unlink').fsPath;
        await fs.symlink('/etc/passwd', unlink_path);
        await openedRepository.exec(['add', unlink_path as RelativePath]);
        await openedRepository.exec([
            'commit',
            unlink_path as RelativePath,
            '-m',
            'added unlink' as FossilCommitMessage,
        ]);
        await fs.rm(unlink_path);
        await fs.writeFile(unlink_path, '/etc/passwd');

        // NOT A FILE
        const not_file_path = (
            await add('not_file', 'not_file_path', 'added not_file')
        ).fsPath;
        await fs.unlink(not_file_path);
        await fs.mkdir(not_file_path);

        await repository.updateStatus('Test' as Reason);
        assertGroups(repository, {
            working: [
                [executable_path, ResourceStatus.MODIFIED],
                [unexec_path, ResourceStatus.MODIFIED],
                [symlink_path, ResourceStatus.MODIFIED],
                [unlink_path, ResourceStatus.MODIFIED],
                [not_file_path, ResourceStatus.MISSING],
            ],
        });
        await fs.rmdir(not_file_path);
    }).timeout(20000);

    const testRename = async (
        status: `${'RENAMED' | 'EDITED'} ${'a' | 'a.txt  ->  b'}.txt`,
        before: 'a.txt',
        after: 'a.txt' | 'b.txt',
        resourceStatus: ResourceStatus
    ) => {
        const repository = getRepository();
        const execStub = getExecStub(this.ctx.sandbox);
        fakeFossilStatus(execStub, status);
        await repository.updateStatus('Test' as Reason);
        const root = vscode.workspace.workspaceFolders![0].uri;
        const uriBefore = Uri.joinPath(root, before);
        const uriAfter = Uri.joinPath(root, after);
        assertGroups(repository, {
            working: [[uriAfter.fsPath, resourceStatus]],
        });
        const resource = repository.workingGroup.resourceStates[0];
        assert.equal(resource.original.toString(), uriBefore.toString());
        assert.ok(resource.renameResourceUri);
        assert.equal(
            resource.renameResourceUri.toString(),
            uriAfter.toString()
        );
    };

    test('Renamed (pre 2.19)', async () => {
        await testRename(
            'RENAMED a.txt',
            'a.txt',
            'a.txt',
            ResourceStatus.RENAMED
        );
    });

    test('Renamed (since 2.19)', async () => {
        await testRename(
            'RENAMED a.txt  ->  b.txt',
            'a.txt',
            'b.txt',
            ResourceStatus.RENAMED
        );
    });

    test('Renamed (since 2.23)', async () => {
        await testRename(
            'EDITED a.txt  ->  b.txt',
            'a.txt',
            'b.txt',
            ResourceStatus.MODIFIED
        );
    });

    test('"Refresh" command refreshes everything', async () => {
        const execStub = getExecStub(this.ctx.sandbox);
        const status = fakeFossilStatus(execStub, 'EXTRA refresh.txt\n');
        const branch = fakeFossilBranch(execStub, 'refresh');
        const changes = fakeFossilChanges(execStub, '12 files modified.');
        await commands.executeCommand('fossil.refresh');
        sinon.assert.calledThrice(execStub);
        sinon.assert.calledOnce(status);
        sinon.assert.calledOnce(branch);
        sinon.assert.calledOnce(changes);

        // reset everything, not leaving 'refresh' as current branch
        branch.resolves(fakeExecutionResult({ stdout: 'trunk' }));
        changes.resolves(
            fakeExecutionResult({ stdout: 'changes: None. Already up-to-date' })
        );
        status.resolves(fakeStatusResult(''));
        await commands.executeCommand('fossil.refresh');
        assertGroups(getRepository(), {});
    });

    test('Branch change is reflected in status bar', async () => {
        // 1. Check current branch name
        const branchCommandBefore = statusBarCommands()[0];
        assert.equal(branchCommandBefore.title, '$(git-branch) trunk');

        // 2. Create branch
        const branchName = 'statusbar1' as FossilBranch;
        const cib = this.ctx.sandbox.stub(window, 'createInputBox');
        cib.onFirstCall().callsFake(() => {
            const inputBox: vscode.InputBox = cib.wrappedMethod();
            const stub = sinon.stub(inputBox);
            stub.show.callsFake(() => {
                stub.value = branchName;
                const onDidAccept = stub.onDidAccept.getCall(0).args[0];
                onDidAccept();
            });
            return stub;
        });

        const execStub = getExecStub(this.ctx.sandbox);
        fakeFossilStatus(execStub, '\n'); // ensure branch doesn't get '+'
        const branchCreation = execStub.withArgs([
            'branch',
            'new',
            branchName,
            'current',
        ]);
        await commands.executeCommand('fossil.branch');
        sinon.assert.calledOnce(branchCreation);

        // 3. Change the branch
        const branchSwitch = execStub.withArgs(['update', branchName]);
        const sqp = this.ctx.sandbox.stub(window, 'showQuickPick');
        sqp.onFirstCall().callsFake(items => {
            assert.ok(items instanceof Array);
            const item = items.find(
                item => item.label == `$(git-branch) ${branchName}`
            );
            assert.ok(item);
            assert.equal(item.description, '');
            assert.equal(item.detail, undefined);
            return Promise.resolve(item);
        });
        await commands.executeCommand('fossil.branchChange');
        sinon.assert.calledOnce(sqp);
        sinon.assert.calledOnce(branchSwitch);

        // 4. Check branch name is changed
        const branchCommandAfter = statusBarCommands()[0];
        assert.equal(branchCommandAfter.title, `$(git-branch) ${branchName}`);

        // 5. Change branch back to 'trunk'
        sqp.onSecondCall().callsFake(items => {
            assert.ok(items instanceof Array);
            const item = items.find(
                item => item.label == '$(git-branch) trunk'
            );
            assert.ok(item);
            assert.equal(item.label, `$(git-branch) trunk`);
            assert.equal(item.description, '');
            assert.equal(item.detail, undefined);
            return Promise.resolve(item);
        });
        await commands.executeCommand('fossil.branchChange');
        sinon.assert.calledTwice(sqp);
        const branchCommandLast = statusBarCommands()[0];
        assert.equal(branchCommandLast.title, `$(git-branch) trunk`);
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
            'closed' as FossilTag,
            'trunk' as FossilBranch,
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
            'closed' as FossilTag,
            'trunk' as FossilBranch,
        ]);
    });
}

export function CleanSuite(this: Suite): void {
    let rootUri: Uri;

    before(() => {
        rootUri = workspace.workspaceFolders![0].uri;
    });

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
        fakeFossilStatus(execStub, 'EXTRA a.txt\nEXTRA b.txt');
        await repository.updateStatus('Test' as Reason);
        assertGroups(repository, {
            untracked: [
                [Uri.joinPath(rootUri, 'a.txt').fsPath, ResourceStatus.EXTRA],
                [Uri.joinPath(rootUri, 'b.txt').fsPath, ResourceStatus.EXTRA],
            ],
        });
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
        fakeFossilStatus(execStub, 'EXTRA a.txt\nEXTRA b.txt\nEXTRA c.txt');
        await repository.updateStatus('Test' as Reason);
        assertGroups(repository, {
            untracked: [
                [Uri.joinPath(rootUri, 'a.txt').fsPath, ResourceStatus.EXTRA],
                [Uri.joinPath(rootUri, 'b.txt').fsPath, ResourceStatus.EXTRA],
                [Uri.joinPath(rootUri, 'c.txt').fsPath, ResourceStatus.EXTRA],
            ],
        });
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
        sinon.assert.calledOnceWithMatch(cleanCallStub, [
            'clean',
            ...repository.untrackedGroup.resourceStates.map(
                r => r.resourceUri.fsPath
            ),
        ]);
    }).timeout(5000);
}

export function FileSystemSuite(this: Suite): void {
    test('Open document', async () => {
        const cat = getRawExecStub(this.ctx.sandbox)
            .withArgs(sinon.match.array.startsWith(['cat']))
            .resolves(fakeRawExecutionResult({ stdout: 'document text\n' }));
        const uri = Uri.joinPath(
            vscode.workspace.workspaceFolders![0].uri,
            'test.txt'
        );
        const fossilUri = toFossilUri(uri);
        const document = await workspace.openTextDocument(fossilUri);
        sinon.assert.calledOnceWithExactly(
            cat,
            [
                'cat',
                'test.txt' as RelativePath,
                '-r',
                'current' as FossilCheckin,
            ],
            { cwd: sinon.match.string }
        );
        assert.equal(document.getText(), 'document text\n');
    });
}

export function DiffSuite(this: Suite): void {
    test('Open File From Uri (Nothing)', async () => {
        await commands.executeCommand('fossil.openFileFromUri');
    });

    test('Open File From Uri (non existing fossil path)', async () => {
        const uri = Uri.from({ scheme: 'fossil', path: 'nowhere' });
        await commands.executeCommand('fossil.openFileFromUri', uri);
    });

    test('Open File From Uri (existing fossil path)', async () => {
        const repository = getRepository();
        const rootUri = workspace.workspaceFolders![0].uri;
        const uri = Uri.joinPath(rootUri, 'a_path.txt');
        const execStub = getExecStub(this.ctx.sandbox);
        const statusCall = fakeFossilStatus(execStub, 'ADDED a_path.txt');
        await repository.updateStatus('Test' as Reason);
        sinon.assert.calledOnce(statusCall);

        const testTd = { isUntitled: false } as vscode.TextDocument;
        const otd = this.ctx.sandbox
            .stub(workspace, 'openTextDocument')
            .resolves(testTd);
        const std = this.ctx.sandbox
            .stub(window, 'showTextDocument')
            .resolves();
        await commands.executeCommand('fossil.openFileFromUri', uri);
        sinon.assert.calledOnceWithExactly(
            otd,
            sinon.match({ path: uri.fsPath })
        );
        sinon.assert.calledOnceWithExactly(
            std,
            testTd as any,
            {
                preview: true,
                preserveFocus: true,
                viewColumn: vscode.ViewColumn.Active,
            } as vscode.TextDocumentShowOptions
        );
    });

    test('Open Change From Uri (Nothing)', async () => {
        await commands.executeCommand('fossil.openChangeFromUri');
    });

    test('Open Change (Nothing)', async () => {
        await commands.executeCommand('fossil.openChange');
    });
}
