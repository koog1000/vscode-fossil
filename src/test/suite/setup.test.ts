import {
    window,
    Uri,
    workspace,
    ExtensionContext,
    commands,
    LogOutputChannel,
} from 'vscode';
import {
    SinonStubT,
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
import type {
    FossilCWD,
    FossilExecutablePath,
    FossilVersion,
} from '../../fossilExecutable';
import type { UnvalidatedFossilExecutablePath } from '../../fossilFinder';
import * as fossilFinder from '../../fossilFinder';
import { Suite, afterEach, after, before } from 'mocha';
import * as os from 'os';
import * as fs from 'fs/promises';
import * as cp from 'child_process';
import { activate } from '../../main';
import * as extensionCommands from '../../commands';
import * as fileSystemProvider from '../../fileSystemProvider';
import {
    FossilPath,
    FossilURIString,
    RelativePath,
} from '../../openedRepository';

function ExecutableSuite(this: Suite): void {
    const resetIgnoreMissingFossilWarning = async () => {
        const config = workspace.getConfiguration('fossil');
        await config.update('ignoreMissingFossilWarning', false, false);
    };
    before(resetIgnoreMissingFossilWarning);
    after(resetIgnoreMissingFossilWarning);

    test('Invalid executable path', async () => {
        const outputChanel = {
            info: sinon.stub(),
            warn: sinon.stub(),
        };
        await fossilFinder.findFossil(
            'non_existing_fossil' as UnvalidatedFossilExecutablePath,
            outputChanel as unknown as LogOutputChannel
        );
        sinon.assert.calledOnceWithExactly(
            outputChanel.warn,
            "`fossil.path` 'non_existing_fossil' is unavailable " +
                '(Error: spawn non_existing_fossil ENOENT). ' +
                "Will try 'fossil' as the path"
        );
        sinon.assert.calledWithMatch(
            outputChanel.info,
            /^Using fossil \d.\d+ from fossil$/
        );
    }).timeout(2000);

    test('Execution error is caught and shown', async () => {
        const outputChanel = { error: sinon.stub() };
        const childProcess = {
            on: sinon
                .stub()
                .withArgs('error')
                .callsFake((_what, callback) => {
                    callback(new Error('mocked error'));
                }),
            stdout: {
                on: sinon.stub(),
            },
        };
        this.ctx.sandbox
            .stub(cp, 'spawn')
            .returns(
                childProcess as unknown as cp.ChildProcessWithoutNullStreams
            );
        await fossilFinder.findFossil(
            '' as UnvalidatedFossilExecutablePath,
            outputChanel as unknown as LogOutputChannel
        );
        sinon.assert.calledOnceWithExactly(
            outputChanel.error,
            "'fossil' is unavailable (Error: mocked error). " +
                'Fossil extension commands will be disabled'
        );
    }).timeout(2000);

    class NoFossil {
        public readonly ff: SinonStubT<typeof fossilFinder.findFossil>;
        public readonly svm: SinonStubT<
            (...args: string[]) => string | undefined
        >;
        public context: ReturnType<typeof NoFossil.createContext>;

        constructor(sandbox: sinon.SinonSandbox) {
            sandbox
                .stub(extensionCommands, 'CommandCenter')
                .returns({ dispose: sinon.stub() });
            sandbox
                .stub(fileSystemProvider, 'FossilFileSystemProvider')
                .returns({ dispose: sinon.stub() });
            this.context = NoFossil.createContext();
            this.ff = sandbox.stub(fossilFinder, 'findFossil').resolves();
            this.svm = sandbox
                .stub(window, 'showWarningMessage')
                .resolves() as unknown as SinonStubT<
                (...args: string[]) => string | undefined
            >;
        }

        static createContext() {
            return {
                subscriptions: { push: sinon.stub() },
                extensionUri: Uri.parse('file://from_test'),
            } as const;
        }
        async activate() {
            const model = await activate(
                this.context as unknown as ExtensionContext
            );
            assert.ok(model);
            return model;
        }
    }

    test('User can cancel "no fossil" warning', async () => {
        const noFossil = new NoFossil(this.ctx.sandbox);
        await noFossil.activate();
        sinon.assert.calledOnceWithMatch(
            noFossil.svm,
            'Fossil was not found. Install it or configure it ' +
                "using the 'fossil.path' setting.",
            'Download Fossil',
            'Edit "fossil.path"',
            "Don't Show Again"
        );
    });

    test('Download Fossil button is working', async () => {
        const noFossil = new NoFossil(this.ctx.sandbox);
        noFossil.svm.resolves('Download Fossil');
        const cmd = this.ctx.sandbox
            .stub(commands, 'executeCommand')
            .withArgs('vscode.open')
            .resolves();
        await noFossil.activate();
        sinon.assert.calledOnce(noFossil.svm);
        sinon.assert.calledOnceWithExactly(
            cmd,
            'vscode.open',
            Uri.parse('https://www.fossil-scm.org/')
        );
    });

    test('Edit settings button is working', async () => {
        const noFossil = new NoFossil(this.ctx.sandbox);
        noFossil.svm.resolves('Edit "fossil.path"');
        const cmd = this.ctx.sandbox
            .stub(commands, 'executeCommand')
            .withArgs('workbench.action.openSettings')
            .resolves();
        await noFossil.activate();
        sinon.assert.calledOnce(noFossil.svm);
        sinon.assert.calledOnceWithExactly(
            cmd,
            'workbench.action.openSettings',
            'fossil.path'
        );
    });

    test('"Don\'t Show Again" button is working', async () => {
        const configStub = {
            update: sinon.stub(),
            get: sinon.stub().withArgs('path').returns(''),
        };
        this.ctx.sandbox
            .stub(workspace, 'getConfiguration')
            .callThrough()
            .withArgs('fossil')
            .returns(configStub as any);
        const noFossil = new NoFossil(this.ctx.sandbox);
        noFossil.svm.resolves("Don't Show Again");
        await noFossil.activate();
        sinon.assert.calledOnce(noFossil.svm);
        sinon.assert.calledOnceWithExactly(
            configStub.update,
            'ignoreMissingFossilWarning',
            true,
            false
        );
    });

    const stubActivationActions = () => {
        const ff = this.ctx.sandbox.stub(fossilFinder, 'findFossil').resolves();
        const odcc = this.ctx.sandbox
            .stub(workspace, 'onDidChangeConfiguration')
            .returns({ dispose: this.ctx.sandbox.stub() });
        const rfsp = this.ctx.sandbox.stub(
            workspace,
            'registerFileSystemProvider'
        );
        const rwvps = this.ctx.sandbox.stub(
            window,
            'registerWebviewPanelSerializer'
        );
        const svm = this.ctx.sandbox
            .stub(window, 'showWarningMessage')
            .resolves();
        const configStub = {
            update: sinon.stub(),
            get: sinon.stub().withArgs('path').returns(''),
        };
        this.ctx.sandbox
            .stub(workspace, 'getConfiguration')
            .callThrough()
            .withArgs('fossil')
            .returns(configStub as any);

        return { ff, odcc, rfsp, rwvps, svm, configStub };
    };

    test("User can modify `fossil.path` live after fossil was't found", async () => {
        // create config stub so we can modify `fossil.path` programmatically

        const { ff, odcc, rfsp, rwvps, svm, configStub } =
            stubActivationActions();
        const context = NoFossil.createContext();
        const model = await activate(context as unknown as ExtensionContext);
        sinon.assert.calledOnce(ff);
        sinon.assert.calledOnce(odcc);
        sinon.assert.calledOnce(rwvps);
        sinon.assert.calledOnce(rfsp);
        sinon.assert.calledOnce(svm);
        assert.ok(model);

        const onDidChangeConfiguration = odcc.args[0][0];
        const ec = this.ctx.sandbox.spy(commands, 'executeCommand');

        ff.resolves({
            path: 'a_fossil_path' as FossilExecutablePath,
            version: [2, 20] as FossilVersion,
        });
        configStub.get.withArgs('path').returns('fossil');
        await onDidChangeConfiguration.call(odcc.args[0][1], undefined as any);

        sinon.assert.calledWithExactly(ec, 'setContext', 'fossil.found', true);

        sinon.assert.calledTwice(ff);
        sinon.assert.calledOnce(odcc);
        sinon.assert.calledOnce(rwvps);
        sinon.assert.calledOnce(rfsp);
        sinon.assert.calledOnce(svm);
    });

    test("Fossil state can be changed from 'found' to 'not found'", async () => {
        const { ff, odcc, rfsp, rwvps, svm, configStub } =
            stubActivationActions();
        const context = NoFossil.createContext();
        const model = await activate(context as unknown as ExtensionContext);
        assert.ok(model);
        const ec = this.ctx.sandbox.spy(commands, 'executeCommand');

        ff.resolves(undefined); // do not find any fossil executable
        configStub.get.withArgs('path').returns('bad_fossil_executable');

        const onDidChangeConfiguration = odcc.args[0][0];
        await onDidChangeConfiguration.call(odcc.args[0][1], undefined as any);
        sinon.assert.calledWithExactly(ec, 'setContext', 'fossil.found', false);
        sinon.assert.calledOnce(rfsp);
        sinon.assert.calledOnce(rwvps);
        sinon.assert.calledOnce(svm);
    });
}

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
        await commands.executeCommand('fossil.init');
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

        await commands.executeCommand('fossil.init');
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
        await commands.executeCommand('fossil.init');
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
                window,
                'showInformationMessage'
            ) as sinon.SinonStub
        )
            .withArgs(
                'Would you like to open the cloned repository?',
                'Open Repository'
            )
            .resolves('Open Repository');

        await commands.executeCommand('fossil.init');
        sinon.assert.calledOnce(showSaveDialogStub);
        sinon.assert.calledTwice(showInputBox);
        sinon.assert.calledOnce(showInformationMessage);
        const cwd = os.tmpdir() as FossilCWD;
        sinon.assert.calledOnceWithExactly(initStub, cwd, [
            'init',
            fossilUri.fsPath as FossilPath,
        ]);
        sinon.assert.calledOnceWithExactly(openStub, cwd, [
            'open',
            fossilUri.fsPath as FossilPath,
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
        await commands.executeCommand('fossil.open');
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
        await commands.executeCommand('fossil.open');
        sinon.assert.calledTwice(sod);
    });

    test('Open forced - canceled by user', async () => {
        assert.ok(workspace.workspaceFolders);
        const root = workspace.workspaceFolders[0].uri;
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
        const executable = getExecutable();
        const execStub = this.ctx.sandbox
            .stub(executable, 'exec')
            .callThrough();
        await commands.executeCommand('fossil.open');
        sinon.assert.calledWithExactly(
            execStub.firstCall,
            root.fsPath as FossilCWD,
            ['open', location.fsPath as FossilPath]
        );
        sinon.assert.calledTwice(sod);
    });

    suite('Open and close', function () {
        test('Forced open', async () => {
            await fossilOpenForce(this.ctx.sandbox);
        }).timeout(7000);

        test('Check unsaved', async () => {
            const executable = getExecutable();
            const uri = workspace.workspaceFolders![0].uri;
            const cwd = uri.fsPath as FossilCWD;
            const filename = Uri.joinPath(uri, 'open_and_close').fsPath;
            await fs.writeFile(filename, '');
            const addRes = await executable.exec(cwd, [
                'add',
                filename as RelativePath,
            ]);
            assert.match(addRes.stdout, /ADDED/);

            const swm: sinon.SinonStub = this.ctx.sandbox
                .stub(window, 'showWarningMessage')
                .resolves();

            await commands.executeCommand('fossil.close');
            sinon.assert.calledOnceWithExactly(
                swm,
                sinon.match(
                    /^Fossil: there are unsaved changes in the current check-?out$/
                )
            );
        }).timeout(3500);

        test('Close', async () => {
            const executable = getExecutable();
            const uri = workspace.workspaceFolders![0].uri;
            const cwd = uri.fsPath as FossilCWD;
            await cleanupFossil(getRepository());
            const closeStub = this.ctx.sandbox
                .spy(executable, 'exec')
                .withArgs(cwd, sinon.match.array.startsWith(['close']));

            await commands.executeCommand('fossil.close');
            sinon.assert.calledOnce(closeStub);

            const statusResult = await executable.exec(cwd, [
                'status',
                '--differ',
                '--merge',
            ]);
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
            .stub(window, 'showInputBox')
            .resolves('');
        await commands.executeCommand('fossil.clone');
        sinon.assert.calledOnce(showInputBox);
    });

    test('URI without auth', async () => {
        const showInputBox = this.ctx.sandbox.stub(window, 'showInputBox');
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
                window,
                'showInformationMessage'
            ) as sinon.SinonStub
        )
            .withArgs(
                'Would you like to open the cloned repository?',
                'Open Repository'
            )
            .resolves();

        const showSaveDialogStub = this.ctx.sandbox
            .stub(window, 'showSaveDialog')
            .withArgs(sinon.match({ title: 'Select New Fossil File Location' }))
            .resolves(Uri.joinPath(Uri.file(os.tmpdir()), 'test_path'));

        const executable = getExecutable();

        const execStub = this.ctx.sandbox.stub(executable, 'exec');

        await commands.executeCommand('fossil.clone');
        sinon.assert.calledOnce(inputURI);
        sinon.assert.calledOnce(inputUsername);
        sinon.assert.calledOnce(inputPassword);
        sinon.assert.calledOnce(showSaveDialogStub);
        sinon.assert.calledOnce(showInformationMessage);
        sinon.assert.calledOnceWithExactly(execStub, os.tmpdir() as FossilCWD, [
            'clone',
            'https://testuser:testpsw@example.com/fossil' as FossilURIString,
            '/tmp/test_path' as FossilPath,
            '--verbose',
        ]);
    });

    test('URI with username and password', async () => {
        const showInputBox = this.ctx.sandbox.stub(window, 'showInputBox');
        const inputURI = showInputBox
            .withArgs(sinon.match({ prompt: 'Repository URI' }))
            .resolves('https://testuser:testpsw@example.com/fossil');
        const showInformationMessage = (
            this.ctx.sandbox.stub(
                window,
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
            .stub(window, 'showSaveDialog')
            .withArgs(sinon.match({ title: 'Select New Fossil File Location' }))
            .resolves(tmpUri);

        const executable = getExecutable();

        const execStub = this.ctx.sandbox.stub(executable, 'exec');

        await commands.executeCommand('fossil.clone');
        sinon.assert.calledOnce(inputURI);
        sinon.assert.calledOnce(showSaveDialogStub);
        sinon.assert.calledOnce(showInformationMessage);
        sinon.assert.calledOnceWithExactly(execStub, os.tmpdir() as FossilCWD, [
            'clone',
            'https://testuser:testpsw@example.com/fossil' as FossilURIString,
            tmpUri.fsPath as FossilPath,
            '--verbose',
        ]);
    });

    test('URI with username only', async () => {
        const showInputBox = this.ctx.sandbox.stub(window, 'showInputBox');
        const inputURI = showInputBox
            .withArgs(sinon.match({ prompt: 'Repository URI' }))
            .resolves('https://testuser@example.com/fossil');
        const inputPassword = showInputBox
            .withArgs(sinon.match({ prompt: 'User Authentication' }))
            .resolves('testpsw');
        const showInformationMessage = (
            this.ctx.sandbox.stub(
                window,
                'showInformationMessage'
            ) as sinon.SinonStub
        )
            .withArgs(
                'Would you like to open the cloned repository?',
                'Open Repository'
            )
            .resolves();

        const showSaveDialogStub = this.ctx.sandbox
            .stub(window, 'showSaveDialog')
            .withArgs(sinon.match({ title: 'Select New Fossil File Location' }))
            .resolves(Uri.joinPath(Uri.file(os.tmpdir()), 'test_path'));

        const executable = getExecutable();

        const execStub = this.ctx.sandbox.stub(executable, 'exec');

        await commands.executeCommand('fossil.clone');
        sinon.assert.calledOnce(inputURI);
        sinon.assert.calledOnce(inputPassword);
        sinon.assert.calledOnce(showSaveDialogStub);
        sinon.assert.calledOnce(showInformationMessage);
        sinon.assert.calledOnceWithExactly(execStub, os.tmpdir() as FossilCWD, [
            'clone',
            'https://testuser:testpsw@example.com/fossil' as FossilURIString,
            '/tmp/test_path' as FossilPath,
            '--verbose',
        ]);
    });

    test('Cancel username', async () => {
        const showInputBox = this.ctx.sandbox.stub(window, 'showInputBox');
        const inputURI = showInputBox
            .withArgs(sinon.match({ prompt: 'Repository URI' }))
            .resolves('https://example.com/fossil');
        const inputUsername = showInputBox
            .withArgs(sinon.match({ prompt: 'Username' }))
            .resolves();
        await commands.executeCommand('fossil.clone');
        sinon.assert.calledOnce(inputURI);
        sinon.assert.calledOnce(inputUsername);
    });

    test('Empty password', async () => {
        const showInputBox = this.ctx.sandbox.stub(window, 'showInputBox');
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
                window,
                'showInformationMessage'
            ) as sinon.SinonStub
        )
            .withArgs(
                'Would you like to open the cloned repository?',
                'Open Repository'
            )
            .resolves();

        const showSaveDialogStub = this.ctx.sandbox
            .stub(window, 'showSaveDialog')
            .withArgs(sinon.match({ title: 'Select New Fossil File Location' }))
            .resolves(Uri.joinPath(Uri.file(os.tmpdir()), 'test_path'));

        const executable = getExecutable();

        const execStub = this.ctx.sandbox.stub(executable, 'exec');

        await commands.executeCommand('fossil.clone');
        sinon.assert.calledOnce(inputURI);
        sinon.assert.calledOnce(inputUsername);
        sinon.assert.calledOnce(inputPassword);
        sinon.assert.calledOnce(showSaveDialogStub);
        sinon.assert.calledOnce(showInformationMessage);
        sinon.assert.calledOnceWithExactly(execStub, os.tmpdir() as FossilCWD, [
            'clone',
            'https://testuser@example.com/fossil' as FossilURIString,
            '/tmp/test_path' as FossilPath,
            '--verbose',
        ]);
    });

    test('Cancel on path', async () => {
        const showInputBox = this.ctx.sandbox.stub(window, 'showInputBox');
        const inputURI = showInputBox
            .withArgs(sinon.match({ prompt: 'Repository URI' }))
            .resolves('https://testuser:testpsw@example.com/fossil');
        const showSaveDialogStub = this.ctx.sandbox
            .stub(window, 'showSaveDialog')
            .withArgs(sinon.match({ title: 'Select New Fossil File Location' }))
            .resolves();

        const executable = getExecutable();
        const execStub = this.ctx.sandbox.spy(executable, 'exec');

        await commands.executeCommand('fossil.clone');
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
    suite('Executable', ExecutableSuite);
    suite('Init', InitSuite);
    suite('Open', OpenSuite);
    suite('Clone', CloneSuite);
});
