import * as vscode from 'vscode';
import { window, Uri } from 'vscode';
import {
    cleanRoot,
    cleanupFossil,
    fakeExecutionResult,
    fossilInit,
    fossilOpenForce,
    getExecutable,
    getRepository,
} from './common';
import * as sinon from 'sinon';
import * as assert from 'assert/strict';
import { FossilCWD } from '../../fossilExecutable';
import { Suite, afterEach, before } from 'mocha';
import * as os from 'os';
import * as fs from 'fs/promises';

function InitSuite(this: Suite): void {
    test('Create repository (fossil.init)', async () => {
        await cleanRoot();
        await fossilInit(this.ctx.sandbox);
    }).timeout(2000);

    test('No path selected', async () => {
        const showSaveDialogStub = this.ctx.sandbox
            .stub(window, 'showSaveDialog')
            .withArgs(sinon.match({ title: 'Select New Fossil File Location' }))
            .resolves();
        await vscode.commands.executeCommand('fossil.init');
        sinon.assert.calledOnce(showSaveDialogStub);
    }).timeout(200);

    test('No project name selected', async () => {
        const showSaveDialogStub = this.ctx.sandbox
            .stub(window, 'showSaveDialog')
            .withArgs(sinon.match({ title: 'Select New Fossil File Location' }))
            .resolves(Uri.joinPath(Uri.file(os.tmpdir()), 'virtual.fossil'));
        const showInputBox = this.ctx.sandbox
            .stub(window, 'showInputBox')
            .withArgs(sinon.match({ prompt: 'Project Name' }))
            .resolves();

        await vscode.commands.executeCommand('fossil.init');
        sinon.assert.calledOnce(showSaveDialogStub);
        sinon.assert.calledOnce(showInputBox);
    }).timeout(200);

    test('No description selected', async () => {
        const showSaveDialogStub = this.ctx.sandbox
            .stub(window, 'showSaveDialog')
            .withArgs(sinon.match({ title: 'Select New Fossil File Location' }))
            .resolves(Uri.joinPath(Uri.file(os.tmpdir()), 'virtual.fossil'));
        const showInputBox = this.ctx.sandbox.stub(window, 'showInputBox');
        showInputBox
            .withArgs(sinon.match({ prompt: 'Project Name' }))
            .resolves('aname');
        showInputBox
            .withArgs(sinon.match({ prompt: 'Project Description' }))
            .resolves();
        await vscode.commands.executeCommand('fossil.init');
        sinon.assert.calledOnce(showSaveDialogStub);
        sinon.assert.calledTwice(showInputBox);
    }).timeout(200);

    test('Open after initialization', async () => {
        const fossilUri = Uri.joinPath(Uri.file(os.tmpdir()), 'virtual.fossil');
        const showSaveDialogStub = this.ctx.sandbox
            .stub(window, 'showSaveDialog')
            .withArgs(sinon.match({ title: 'Select New Fossil File Location' }))
            .resolves(fossilUri);
        const showInputBox = this.ctx.sandbox.stub(window, 'showInputBox');
        showInputBox
            .withArgs(sinon.match({ prompt: 'Project Name' }))
            .resolves('');
        showInputBox
            .withArgs(sinon.match({ prompt: 'Project Description' }))
            .resolves('');
        const executable = getExecutable();
        const execStub = this.ctx.sandbox
            .stub(executable, 'exec')
            .resolves(fakeExecutionResult());
        const initStub = execStub.withArgs(
            sinon.match.string,
            sinon.match.array.startsWith(['init'])
        );
        const openStub = execStub.withArgs(
            sinon.match.string,
            sinon.match.array.startsWith(['open'])
        );
        const showInformationMessage = (
            this.ctx.sandbox.stub(
                vscode.window,
                'showInformationMessage'
            ) as sinon.SinonStub
        )
            .withArgs(
                'Would you like to open the cloned repository?',
                'Open Repository'
            )
            .resolves('Open Repository');

        await vscode.commands.executeCommand('fossil.init');
        sinon.assert.calledOnce(showSaveDialogStub);
        sinon.assert.calledTwice(showInputBox);
        sinon.assert.calledOnce(showInformationMessage);
        const cwd = os.tmpdir() as FossilCWD;
        sinon.assert.calledOnceWithExactly(initStub, cwd, [
            'init',
            fossilUri.fsPath,
        ]);
        sinon.assert.calledOnceWithExactly(openStub, cwd, [
            'open',
            fossilUri.fsPath,
        ]);
    }).timeout(6000);
}

function OpenSuite(this: Suite): void {
    before(async () => {
        await cleanRoot();
        await fossilInit(this.ctx.sandbox);
    });

    test('Open - cancel path', async () => {
        const sod = this.ctx.sandbox.stub(window, 'showOpenDialog');
        sod.withArgs(
            sinon.match({ openLabel: 'Repository Location' })
        ).resolves();
        await vscode.commands.executeCommand('fossil.open');
        sinon.assert.calledOnce(sod);
    });

    test('Open - cancel root', async () => {
        const sod = this.ctx.sandbox.stub(window, 'showOpenDialog');
        sod.withArgs(
            sinon.match({ openLabel: 'Repository Location' })
        ).resolves([Uri.file('test')]);
        sod.withArgs(
            sinon.match({ title: 'Select Fossil Root Directory' })
        ).resolves();
        await vscode.commands.executeCommand('fossil.open');
        sinon.assert.calledTwice(sod);
    });

    test('Open forced - canceled by user', async () => {
        assert.ok(vscode.workspace.workspaceFolders);
        const root = vscode.workspace.workspaceFolders[0].uri;
        const location = Uri.joinPath(root, '/test.fossil');
        const sod = this.ctx.sandbox.stub(window, 'showOpenDialog');
        sod.withArgs(
            sinon.match({ openLabel: 'Repository Location' })
        ).resolves([location]);
        sod.withArgs(
            sinon.match({ title: 'Select Fossil Root Directory' })
        ).resolves([root]);
        const swm: sinon.SinonStub = this.ctx.sandbox.stub(
            window,
            'showWarningMessage'
        );
        swm.withArgs(
            `The directory ${root.fsPath} is not empty.\n` +
                'Open repository here anyway?',
            { modal: true },
            '&&Open Repository'
        ).resolves();
        await fs.writeFile(Uri.joinPath(root, 'junk').fsPath, '');
        console.log('before `fossil.open`');
        const executable = getExecutable();
        const execStub = this.ctx.sandbox
            .stub(executable, 'exec')
            .callThrough();
        await vscode.commands.executeCommand('fossil.open');
        sinon.assert.calledWithExactly(
            execStub.firstCall,
            root.fsPath as FossilCWD,
            ['open', location.fsPath]
        );
        sinon.assert.calledTwice(sod);
    });

    suite('Open and close', function () {
        test('Forced open', async () => {
            await fossilOpenForce(this.ctx.sandbox);
        }).timeout(7000);

        test('Check unsaved', async () => {
            const executable = getExecutable();
            const uri = vscode.workspace.workspaceFolders![0].uri;
            const cwd = uri.fsPath as FossilCWD;
            const filename = Uri.joinPath(uri, 'open_and_close').fsPath;
            await fs.writeFile(filename, '');
            const addRes = await executable.exec(cwd, ['add', filename]);
            assert.match(addRes.stdout, /ADDED/);

            const swm: sinon.SinonStub = this.ctx.sandbox
                .stub(vscode.window, 'showWarningMessage')
                .resolves();

            await vscode.commands.executeCommand('fossil.close');
            sinon.assert.calledOnceWithExactly(
                swm,
                sinon.match(
                    /^Fossil: there are unsaved changes in the current check-?out$/
                )
            );
        }).timeout(3500);

        test('Close', async () => {
            const repository = getRepository();
            const executable = getExecutable();
            const uri = vscode.workspace.workspaceFolders![0].uri;
            const cwd = uri.fsPath as FossilCWD;
            await cleanupFossil(repository);
            const closeStub = this.ctx.sandbox
                .spy(executable, 'exec')
                .withArgs(cwd, sinon.match.array.startsWith(['close']));

            await vscode.commands.executeCommand('fossil.close');
            sinon.assert.calledOnce(closeStub);

            const statusResult = await executable.exec(cwd, ['status']);
            await assert.match(
                statusResult.stderr,
                /^current directory is not within an open check-?out\s*$/
            );
        }).timeout(7000);
    });
}

function CloneSuite(this: Suite): void {
    test('Empty URI', async () => {
        const showInputBox = this.ctx.sandbox
            .stub(vscode.window, 'showInputBox')
            .resolves('');
        await vscode.commands.executeCommand('fossil.clone');
        sinon.assert.calledOnce(showInputBox);
    });

    test('URI without auth', async () => {
        const showInputBox = this.ctx.sandbox.stub(
            vscode.window,
            'showInputBox'
        );
        const inputURI = showInputBox
            .withArgs(sinon.match({ prompt: 'Repository URI' }))
            .resolves('https://example.com/fossil');
        const inputUsername = showInputBox
            .withArgs(sinon.match({ prompt: 'Username' }))
            .resolves('testuser');
        const inputPassword = showInputBox
            .withArgs(sinon.match({ prompt: 'User Authentication' }))
            .resolves('testpsw');
        const showInformationMessage = (
            this.ctx.sandbox.stub(
                vscode.window,
                'showInformationMessage'
            ) as sinon.SinonStub
        )
            .withArgs(
                'Would you like to open the cloned repository?',
                'Open Repository'
            )
            .resolves();

        const showSaveDialogStub = this.ctx.sandbox
            .stub(vscode.window, 'showSaveDialog')
            .withArgs(sinon.match({ title: 'Select New Fossil File Location' }))
            .resolves(Uri.joinPath(Uri.file(os.tmpdir()), 'test_path'));

        const executable = getExecutable();

        const execStub = this.ctx.sandbox.stub(executable, 'exec');

        await vscode.commands.executeCommand('fossil.clone');
        sinon.assert.calledOnce(inputURI);
        sinon.assert.calledOnce(inputUsername);
        sinon.assert.calledOnce(inputPassword);
        sinon.assert.calledOnce(showSaveDialogStub);
        sinon.assert.calledOnce(showInformationMessage);
        sinon.assert.calledOnceWithExactly(execStub, os.tmpdir() as FossilCWD, [
            'clone',
            'https://testuser:testpsw@example.com/fossil',
            '/tmp/test_path',
            '--verbose',
        ]);
    });

    test('URI with username and password', async () => {
        const showInputBox = this.ctx.sandbox.stub(
            vscode.window,
            'showInputBox'
        );
        const inputURI = showInputBox
            .withArgs(sinon.match({ prompt: 'Repository URI' }))
            .resolves('https://testuser:testpsw@example.com/fossil');
        const showInformationMessage = (
            this.ctx.sandbox.stub(
                vscode.window,
                'showInformationMessage'
            ) as sinon.SinonStub
        )
            .withArgs(
                'Would you like to open the cloned repository?',
                'Open Repository'
            )
            .resolves();

        const tmpUri = Uri.joinPath(Uri.file(os.tmpdir()), 'test_path');
        const showSaveDialogStub = this.ctx.sandbox
            .stub(vscode.window, 'showSaveDialog')
            .withArgs(sinon.match({ title: 'Select New Fossil File Location' }))
            .resolves(tmpUri);

        const executable = getExecutable();

        const execStub = this.ctx.sandbox.stub(executable, 'exec');

        await vscode.commands.executeCommand('fossil.clone');
        sinon.assert.calledOnce(inputURI);
        sinon.assert.calledOnce(showSaveDialogStub);
        sinon.assert.calledOnce(showInformationMessage);
        sinon.assert.calledOnceWithExactly(execStub, os.tmpdir() as FossilCWD, [
            'clone',
            'https://testuser:testpsw@example.com/fossil',
            tmpUri.fsPath,
            '--verbose',
        ]);
    });

    test('URI with username only', async () => {
        const showInputBox = this.ctx.sandbox.stub(
            vscode.window,
            'showInputBox'
        );
        const inputURI = showInputBox
            .withArgs(sinon.match({ prompt: 'Repository URI' }))
            .resolves('https://testuser@example.com/fossil');
        const inputPassword = showInputBox
            .withArgs(sinon.match({ prompt: 'User Authentication' }))
            .resolves('testpsw');
        const showInformationMessage = (
            this.ctx.sandbox.stub(
                vscode.window,
                'showInformationMessage'
            ) as sinon.SinonStub
        )
            .withArgs(
                'Would you like to open the cloned repository?',
                'Open Repository'
            )
            .resolves();

        const showSaveDialogStub = this.ctx.sandbox
            .stub(vscode.window, 'showSaveDialog')
            .withArgs(sinon.match({ title: 'Select New Fossil File Location' }))
            .resolves(Uri.joinPath(Uri.file(os.tmpdir()), 'test_path'));

        const executable = getExecutable();

        const execStub = this.ctx.sandbox.stub(executable, 'exec');

        await vscode.commands.executeCommand('fossil.clone');
        sinon.assert.calledOnce(inputURI);
        sinon.assert.calledOnce(inputPassword);
        sinon.assert.calledOnce(showSaveDialogStub);
        sinon.assert.calledOnce(showInformationMessage);
        sinon.assert.calledOnceWithExactly(execStub, os.tmpdir() as FossilCWD, [
            'clone',
            'https://testuser:testpsw@example.com/fossil',
            '/tmp/test_path',
            '--verbose',
        ]);
    });

    test('Cancel username', async () => {
        const showInputBox = this.ctx.sandbox.stub(
            vscode.window,
            'showInputBox'
        );
        const inputURI = showInputBox
            .withArgs(sinon.match({ prompt: 'Repository URI' }))
            .resolves('https://example.com/fossil');
        const inputUsername = showInputBox
            .withArgs(sinon.match({ prompt: 'Username' }))
            .resolves();
        await vscode.commands.executeCommand('fossil.clone');
        sinon.assert.calledOnce(inputURI);
        sinon.assert.calledOnce(inputUsername);
    });

    test('Empty password', async () => {
        const showInputBox = this.ctx.sandbox.stub(
            vscode.window,
            'showInputBox'
        );
        const inputURI = showInputBox
            .withArgs(sinon.match({ prompt: 'Repository URI' }))
            .resolves('https://example.com/fossil');
        const inputUsername = showInputBox
            .withArgs(sinon.match({ prompt: 'Username' }))
            .resolves('testuser');
        const inputPassword = showInputBox
            .withArgs(sinon.match({ prompt: 'User Authentication' }))
            .resolves('');
        const showInformationMessage = (
            this.ctx.sandbox.stub(
                vscode.window,
                'showInformationMessage'
            ) as sinon.SinonStub
        )
            .withArgs(
                'Would you like to open the cloned repository?',
                'Open Repository'
            )
            .resolves();

        const showSaveDialogStub = this.ctx.sandbox
            .stub(vscode.window, 'showSaveDialog')
            .withArgs(sinon.match({ title: 'Select New Fossil File Location' }))
            .resolves(Uri.joinPath(Uri.file(os.tmpdir()), 'test_path'));

        const executable = getExecutable();

        const execStub = this.ctx.sandbox.stub(executable, 'exec');

        await vscode.commands.executeCommand('fossil.clone');
        sinon.assert.calledOnce(inputURI);
        sinon.assert.calledOnce(inputUsername);
        sinon.assert.calledOnce(inputPassword);
        sinon.assert.calledOnce(showSaveDialogStub);
        sinon.assert.calledOnce(showInformationMessage);
        sinon.assert.calledOnceWithExactly(execStub, os.tmpdir() as FossilCWD, [
            'clone',
            'https://testuser@example.com/fossil',
            '/tmp/test_path',
            '--verbose',
        ]);
    });

    test('Cancel on path', async () => {
        const showInputBox = this.ctx.sandbox.stub(
            vscode.window,
            'showInputBox'
        );
        const inputURI = showInputBox
            .withArgs(sinon.match({ prompt: 'Repository URI' }))
            .resolves('https://testuser:testpsw@example.com/fossil');
        const showSaveDialogStub = this.ctx.sandbox
            .stub(vscode.window, 'showSaveDialog')
            .withArgs(sinon.match({ title: 'Select New Fossil File Location' }))
            .resolves();

        const executable = getExecutable();
        const execStub = this.ctx.sandbox.spy(executable, 'exec');

        await vscode.commands.executeCommand('fossil.clone');
        sinon.assert.calledOnce(inputURI);
        sinon.assert.calledOnce(showSaveDialogStub);
        sinon.assert.notCalled(execStub);
    });
}

suite('Setup', function () {
    this.ctx.sandbox = sinon.createSandbox();
    afterEach(() => {
        this.ctx.sandbox.restore();
    });
    suite('Init', InitSuite);
    suite('Open', OpenSuite);
    suite('Clone', CloneSuite);
});
