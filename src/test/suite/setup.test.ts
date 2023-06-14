import * as vscode from 'vscode';
import { window, Uri } from 'vscode';
import {
    cleanRoot,
    fakeExecutionResult,
    fossilInit,
    fossilOpen,
    getExecutable,
} from './common';
import * as sinon from 'sinon';
import * as assert from 'assert/strict';
import { FossilCWD } from '../../fossilExecutable';
import { afterEach, before } from 'mocha';
import * as os from 'os';
import * as fs from 'fs/promises';

suite('Setup', () => {
    const sandbox = sinon.createSandbox();

    afterEach(() => {
        sandbox.restore();
    });

    suite('Init', function () {
        test('Working', async () => {
            await cleanRoot();
            await fossilInit(sandbox);
        }).timeout(2000);
        test('No path selected', async () => {
            const showSaveDialogStub = sandbox
                .stub(window, 'showSaveDialog')
                .withArgs(
                    sinon.match({ title: 'Select New Fossil File Location' })
                )
                .resolves();
            await vscode.commands.executeCommand('fossil.init');
            sinon.assert.calledOnce(showSaveDialogStub);
        }).timeout(200);
        test('No project name selected', async () => {
            const showSaveDialogStub = sandbox
                .stub(window, 'showSaveDialog')
                .withArgs(
                    sinon.match({ title: 'Select New Fossil File Location' })
                )
                .resolves(
                    Uri.joinPath(Uri.file(os.tmpdir()), 'virtual.fossil')
                );
            const showInputBox = sandbox.stub(window, 'showInputBox');
            showInputBox
                .withArgs(sinon.match({ prompt: 'Project Name' }))
                .resolves();

            await vscode.commands.executeCommand('fossil.init');
            sinon.assert.calledOnce(showSaveDialogStub);
            sinon.assert.calledOnce(showInputBox);
        }).timeout(200);
        test('No description selected', async () => {
            const showSaveDialogStub = sandbox
                .stub(window, 'showSaveDialog')
                .withArgs(
                    sinon.match({ title: 'Select New Fossil File Location' })
                )
                .resolves(
                    Uri.joinPath(Uri.file(os.tmpdir()), 'virtual.fossil')
                );
            const showInputBox = sandbox.stub(window, 'showInputBox');
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
            const fossilUri = Uri.joinPath(
                Uri.file(os.tmpdir()),
                'virtual.fossil'
            );
            const showSaveDialogStub = sandbox
                .stub(window, 'showSaveDialog')
                .withArgs(
                    sinon.match({ title: 'Select New Fossil File Location' })
                )
                .resolves(fossilUri);
            const showInputBox = sandbox.stub(window, 'showInputBox');
            showInputBox
                .withArgs(sinon.match({ prompt: 'Project Name' }))
                .resolves('');
            showInputBox
                .withArgs(sinon.match({ prompt: 'Project Description' }))
                .resolves('');
            const executable = getExecutable();
            const execStub = sandbox
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
                sandbox.stub(
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
    });

    suite('Open', () => {
        before(async () => {
            await cleanRoot();
            await fossilInit(sandbox);
        });
        test('Open - cancel path', async () => {
            const sod = sandbox.stub(window, 'showOpenDialog');
            sod.withArgs(
                sinon.match({ openLabel: 'Repository Location' })
            ).resolves();
            await vscode.commands.executeCommand('fossil.open');
            sinon.assert.calledOnce(sod);
        });
        test('Open - cancel root', async () => {
            const sod = sandbox.stub(window, 'showOpenDialog');
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
            const sod = sandbox.stub(window, 'showOpenDialog');
            sod.withArgs(
                sinon.match({ openLabel: 'Repository Location' })
            ).resolves([location]);
            sod.withArgs(
                sinon.match({ title: 'Select Fossil Root Directory' })
            ).resolves([root]);
            const swm: sinon.SinonStub = sandbox.stub(
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
            const execStub = sandbox.stub(executable, 'exec').callThrough();
            await vscode.commands.executeCommand('fossil.open');
            sinon.assert.calledWithExactly(
                execStub.firstCall,
                root.fsPath as FossilCWD,
                ['open', location.fsPath]
            );
            sinon.assert.calledTwice(sod);
        });
        test('Open and close', async () => {
            const cwd = vscode.workspace.workspaceFolders![0].uri
                .fsPath as FossilCWD;
            const swm: sinon.SinonStub = sandbox.stub(
                window,
                'showWarningMessage'
            );
            swm.withArgs(
                `The directory ${cwd} is not empty.\n` +
                    'Open repository here anyway?',
                { modal: true },
                '&&Open Repository'
            ).resolves('&&Open Repository');

            await fossilOpen(sandbox);
            sinon.assert.calledOnce(swm);
            const executable = getExecutable();
            await vscode.commands.executeCommand('fossil.close');
            const res_promise = executable.exec(cwd, ['status']);
            await assert.rejects(res_promise, (thrown: any): boolean => {
                return /^current directory is not within an open check-?out\s*$/.test(
                    thrown.stderr
                );
            });
        }).timeout(7000);
    });
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

            const showSaveDialogStub = sandbox
                .stub(vscode.window, 'showSaveDialog')
                .withArgs(
                    sinon.match({ title: 'Select New Fossil File Location' })
                )
                .resolves(Uri.joinPath(Uri.file(os.tmpdir()), 'test_path'));

            const executable = getExecutable();

            const execStub = sandbox.stub(executable, 'exec');

            await vscode.commands.executeCommand('fossil.clone');
            sinon.assert.calledOnce(inputURI);
            sinon.assert.calledOnce(inputUsername);
            sinon.assert.calledOnce(inputPassword);
            sinon.assert.calledOnce(showSaveDialogStub);
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

            const showSaveDialogStub = sandbox
                .stub(vscode.window, 'showSaveDialog')
                .withArgs(
                    sinon.match({ title: 'Select New Fossil File Location' })
                )
                .resolves(Uri.joinPath(Uri.file(os.tmpdir()), 'test_path'));

            const executable = getExecutable();

            const execStub = sandbox.stub(executable, 'exec');

            await vscode.commands.executeCommand('fossil.clone');
            sinon.assert.calledOnce(inputURI);
            sinon.assert.calledOnce(showSaveDialogStub);
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

            const showSaveDialogStub = sandbox
                .stub(vscode.window, 'showSaveDialog')
                .withArgs(
                    sinon.match({ title: 'Select New Fossil File Location' })
                )
                .resolves(Uri.joinPath(Uri.file(os.tmpdir()), 'test_path'));

            const executable = getExecutable();

            const execStub = sandbox.stub(executable, 'exec');

            await vscode.commands.executeCommand('fossil.clone');
            sinon.assert.calledOnce(inputURI);
            sinon.assert.calledOnce(inputPassword);
            sinon.assert.calledOnce(showSaveDialogStub);
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

            const showSaveDialogStub = sandbox
                .stub(vscode.window, 'showSaveDialog')
                .withArgs(
                    sinon.match({ title: 'Select New Fossil File Location' })
                )
                .resolves(Uri.joinPath(Uri.file(os.tmpdir()), 'test_path'));

            const executable = getExecutable();

            const execStub = sandbox.stub(executable, 'exec');

            await vscode.commands.executeCommand('fossil.clone');
            sinon.assert.calledOnce(inputURI);
            sinon.assert.calledOnce(inputUsername);
            sinon.assert.calledOnce(inputPassword);
            sinon.assert.calledOnce(showSaveDialogStub);
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
            const showSaveDialogStub = sandbox
                .stub(vscode.window, 'showSaveDialog')
                .withArgs(
                    sinon.match({ title: 'Select New Fossil File Location' })
                )
                .resolves();

            const executable = getExecutable();
            const execStub = sandbox.spy(executable, 'exec');

            await vscode.commands.executeCommand('fossil.clone');
            sinon.assert.calledOnce(inputURI);
            sinon.assert.calledOnce(showSaveDialogStub);
            sinon.assert.notCalled(execStub);
        });
    });
});
