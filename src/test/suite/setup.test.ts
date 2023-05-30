import * as vscode from 'vscode';
import { cleanRoot, fossilInit, fossilOpen, getExecutable } from './common';
import * as sinon from 'sinon';
import * as assert from 'assert/strict';
import { FossilCWD } from '../../fossilExecutable';
import { afterEach } from 'mocha';
import * as os from 'os';

suite('Setup', () => {
    const sandbox = sinon.createSandbox();

    afterEach(() => {
        sandbox.restore();
    });

    test('Init', async () => {
        await cleanRoot();
        await fossilInit(sandbox);
    }).timeout(2000);

    test('Close', async () => {
        await cleanRoot();
        await fossilInit(sandbox);
        await fossilOpen(sandbox);
        const cwd = vscode.workspace.workspaceFolders![0].uri
            .fsPath as FossilCWD;
        const executable = getExecutable();
        const res = await executable.exec(cwd, ['info']);
        assert.match(res.stdout, /check-ins:\s+1\s*$/);
        await vscode.commands.executeCommand('fossil.close');
        const res_promise = executable.exec(cwd, ['status']);
        await assert.rejects(res_promise, (thrown: any): boolean => {
            return /^current directory is not within an open check-?out\s*$/.test(
                thrown.stderr
            );
        });
    }).timeout(5000);
    suite('Clone', function () {
        test('Empty URI', async () => {
            const showInputBox = sandbox
                .stub(vscode.window, 'showInputBox')
                .resolves('');
            await vscode.commands.executeCommand('fossil.clone');
            sinon.assert.calledOnce(showInputBox);
        });
        test('URI without auth', async () => {
            const showInputBox = sandbox.stub(vscode.window, 'showInputBox');
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
                sandbox.stub(
                    vscode.window,
                    'showInformationMessage'
                ) as sinon.SinonStub
            )
                .withArgs(
                    'Would you like to open the cloned repository?',
                    'Open Repository'
                )
                .resolves();

            const showSaveDialogstub = sandbox
                .stub(vscode.window, 'showSaveDialog')
                .withArgs(
                    sinon.match({ title: 'Select New Fossil File Location' })
                )
                .resolves(
                    vscode.Uri.joinPath(
                        vscode.Uri.file(os.tmpdir()),
                        'test_path'
                    )
                );

            const executable = getExecutable();

            const execStub = sandbox.stub(executable, 'exec');

            await vscode.commands.executeCommand('fossil.clone');
            sinon.assert.calledOnce(inputURI);
            sinon.assert.calledOnce(inputUsername);
            sinon.assert.calledOnce(inputPassword);
            sinon.assert.calledOnce(showSaveDialogstub);
            sinon.assert.calledOnce(showInformationMessage);
            sinon.assert.calledOnceWithExactly(
                execStub,
                os.tmpdir() as FossilCWD,
                [
                    'clone',
                    'https://testuser:testpsw@example.com/fossil',
                    '/tmp/test_path',
                    '--verbose',
                ]
            );
        });
        test('URI with username and password', async () => {
            const showInputBox = sandbox.stub(vscode.window, 'showInputBox');
            const inputURI = showInputBox
                .withArgs(sinon.match({ prompt: 'Repository URI' }))
                .resolves('https://testuser:testpsw@example.com/fossil');
            const showInformationMessage = (
                sandbox.stub(
                    vscode.window,
                    'showInformationMessage'
                ) as sinon.SinonStub
            )
                .withArgs(
                    'Would you like to open the cloned repository?',
                    'Open Repository'
                )
                .resolves();

            const showSaveDialogstub = sandbox
                .stub(vscode.window, 'showSaveDialog')
                .withArgs(
                    sinon.match({ title: 'Select New Fossil File Location' })
                )
                .resolves(
                    vscode.Uri.joinPath(
                        vscode.Uri.file(os.tmpdir()),
                        'test_path'
                    )
                );

            const executable = getExecutable();

            const execStub = sandbox.stub(executable, 'exec');

            await vscode.commands.executeCommand('fossil.clone');
            sinon.assert.calledOnce(inputURI);
            sinon.assert.calledOnce(showSaveDialogstub);
            sinon.assert.calledOnce(showInformationMessage);
            sinon.assert.calledOnceWithExactly(
                execStub,
                os.tmpdir() as FossilCWD,
                [
                    'clone',
                    'https://testuser:testpsw@example.com/fossil',
                    '/tmp/test_path',
                    '--verbose',
                ]
            );
        });
        test('URI with username only', async () => {
            const showInputBox = sandbox.stub(vscode.window, 'showInputBox');
            const inputURI = showInputBox
                .withArgs(sinon.match({ prompt: 'Repository URI' }))
                .resolves('https://testuser@example.com/fossil');
            const inputPassword = showInputBox
                .withArgs(sinon.match({ prompt: 'User Authentication' }))
                .resolves('testpsw');
            const showInformationMessage = (
                sandbox.stub(
                    vscode.window,
                    'showInformationMessage'
                ) as sinon.SinonStub
            )
                .withArgs(
                    'Would you like to open the cloned repository?',
                    'Open Repository'
                )
                .resolves();

            const showSaveDialogstub = sandbox
                .stub(vscode.window, 'showSaveDialog')
                .withArgs(
                    sinon.match({ title: 'Select New Fossil File Location' })
                )
                .resolves(
                    vscode.Uri.joinPath(
                        vscode.Uri.file(os.tmpdir()),
                        'test_path'
                    )
                );

            const executable = getExecutable();

            const execStub = sandbox.stub(executable, 'exec');

            await vscode.commands.executeCommand('fossil.clone');
            sinon.assert.calledOnce(inputURI);
            sinon.assert.calledOnce(inputPassword);
            sinon.assert.calledOnce(showSaveDialogstub);
            sinon.assert.calledOnce(showInformationMessage);
            sinon.assert.calledOnceWithExactly(
                execStub,
                os.tmpdir() as FossilCWD,
                [
                    'clone',
                    'https://testuser:testpsw@example.com/fossil',
                    '/tmp/test_path',
                    '--verbose',
                ]
            );
        });
        test('Cancel username', async () => {
            const showInputBox = sandbox.stub(vscode.window, 'showInputBox');
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
            const showInputBox = sandbox.stub(vscode.window, 'showInputBox');
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
                sandbox.stub(
                    vscode.window,
                    'showInformationMessage'
                ) as sinon.SinonStub
            )
                .withArgs(
                    'Would you like to open the cloned repository?',
                    'Open Repository'
                )
                .resolves();

            const showSaveDialogstub = sandbox
                .stub(vscode.window, 'showSaveDialog')
                .withArgs(
                    sinon.match({ title: 'Select New Fossil File Location' })
                )
                .resolves(
                    vscode.Uri.joinPath(
                        vscode.Uri.file(os.tmpdir()),
                        'test_path'
                    )
                );

            const executable = getExecutable();

            const execStub = sandbox.stub(executable, 'exec');

            await vscode.commands.executeCommand('fossil.clone');
            sinon.assert.calledOnce(inputURI);
            sinon.assert.calledOnce(inputUsername);
            sinon.assert.calledOnce(inputPassword);
            sinon.assert.calledOnce(showSaveDialogstub);
            sinon.assert.calledOnce(showInformationMessage);
            sinon.assert.calledOnceWithExactly(
                execStub,
                os.tmpdir() as FossilCWD,
                [
                    'clone',
                    'https://testuser@example.com/fossil',
                    '/tmp/test_path',
                    '--verbose',
                ]
            );
        });
        test('Cancel on path', async () => {
            const showInputBox = sandbox.stub(vscode.window, 'showInputBox');
            const inputURI = showInputBox
                .withArgs(sinon.match({ prompt: 'Repository URI' }))
                .resolves('https://testuser:testpsw@example.com/fossil');
            const showSaveDialogstub = sandbox
                .stub(vscode.window, 'showSaveDialog')
                .withArgs(
                    sinon.match({ title: 'Select New Fossil File Location' })
                )
                .resolves();

            const executable = getExecutable();
            const execStub = sandbox.spy(executable, 'exec');

            await vscode.commands.executeCommand('fossil.clone');
            sinon.assert.calledOnce(inputURI);
            sinon.assert.calledOnce(showSaveDialogstub);
            sinon.assert.notCalled(execStub);
        });
    });
});
