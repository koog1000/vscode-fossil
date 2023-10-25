import * as vscode from 'vscode';
import { Uri, window, workspace, commands } from 'vscode';
import * as sinon from 'sinon';
import {
    add,
    assertGroups,
    cleanupFossil,
    fakeFossilStatus,
    fakeRawExecutionResult,
    getExecStub,
    getRawExecStub,
    getRepository,
} from './common';
import * as assert from 'assert/strict';
import * as fs from 'fs/promises';
import { OpenedRepository, ResourceStatus } from '../../openedRepository';
import { Suite, Func, Test } from 'mocha';
import { toFossilUri } from '../../uri';

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

    test('Revert (Nothing)', async () => {
        await commands.executeCommand('fossil.revert');
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
            ['cat', 'test.txt', '-r', 'current'],
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
        await repository.updateModelState();
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
