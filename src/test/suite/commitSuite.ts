import * as vscode from 'vscode';
import { Uri, window, commands } from 'vscode';
import * as sinon from 'sinon';
import {
    ExecStub,
    add,
    assertGroups,
    cleanupFossil,
    fakeExecutionResult,
    fakeFossilStatus,
    fakeRawExecutionResult,
    getExecStub,
    getRawExecStub,
    getRepository,
    stubFossilConfig,
} from './common';
import * as assert from 'assert/strict';
import * as fs from 'fs/promises';
import { Suite, beforeEach } from 'mocha';
import { Reason } from '../../fossilExecutable';
import {
    FossilCommitMessage,
    FossilUsername,
    RelativePath,
    ResourceStatus,
} from '../../openedRepository';

export const commitStagedTest = async (
    sandbox: sinon.SinonSandbox,
    command: 'fossil.commit' | 'fossil.commitStaged',
    execStub?: ExecStub
) => {
    const repository = getRepository();
    assert.equal(
        repository.sourceControl.inputBox.value,
        '',
        'empty input box'
    );
    execStub ??= getExecStub(sandbox);
    const statusStub = fakeFossilStatus(execStub, 'ADDED a\nADDED b\n');
    const commitStub = execStub
        .withArgs(sinon.match.array.startsWith(['commit']))
        .resolves(fakeExecutionResult());
    await repository.updateStatus();
    sinon.assert.calledOnce(statusStub);
    await commands.executeCommand('fossil.stageAll');
    sinon.assert.calledOnce(statusStub);
    const sib = sandbox.stub(window, 'showInputBox').resolves('test message');
    await commands.executeCommand(command);
    sinon.assert.calledTwice(statusStub);
    sinon.assert.calledOnceWithExactly(sib, {
        value: undefined,
        placeHolder: 'Commit message',
        prompt: 'Please provide a commit message',
        ignoreFocusOut: true,
    });
    sinon.assert.calledOnceWithExactly(commitStub, [
        'commit',
        '-m',
        'test message' as FossilCommitMessage,
        '--',
        'a' as RelativePath,
        'b' as RelativePath,
    ]);
};

const singleFileCommitSetup = async (
    sandbox: sinon.SinonSandbox,
    rootUri: Uri
) => {
    const repository = getRepository();
    const execStub = getExecStub(sandbox);
    await commands.executeCommand('fossil.unstageAll');
    const statusStub = fakeFossilStatus(execStub, 'ADDED minimal.txt\n');
    await repository.updateStatus('test' as Reason);
    sinon.assert.calledOnce(statusStub);
    assertGroups(repository, {
        working: [
            [Uri.joinPath(rootUri, 'minimal.txt').fsPath, ResourceStatus.ADDED],
        ],
    });
    await commands.executeCommand('fossil.stageAll');
    assertGroups(repository, {
        staging: [
            [Uri.joinPath(rootUri, 'minimal.txt').fsPath, ResourceStatus.ADDED],
        ],
    });
    return { execStub, repository };
};

export function CommitSuite(this: Suite): void {
    const rootUri = this.ctx.workspaceUri;

    const clearInputBox = () => {
        const repository = getRepository();
        repository.sourceControl.inputBox.value = '';
    };
    beforeEach(clearInputBox);

    test('Commit using input box', async () => {
        const repository = getRepository();
        const execStub = getExecStub(this.ctx.sandbox);
        const statusStub = fakeFossilStatus(execStub, 'ADDED fake.txt\n');
        await repository.updateStatus('Test' as Reason);
        sinon.assert.calledOnce(statusStub);
        assertGroups(repository, {
            working: [
                [
                    Uri.joinPath(rootUri, 'fake.txt').fsPath,
                    ResourceStatus.ADDED,
                ],
            ],
        });
        const commitStub = execStub
            .withArgs(['commit', '-m', 'non empty message', '--', 'fake.txt'])
            .resolves(fakeExecutionResult());

        const swm: sinon.SinonStub = this.ctx.sandbox.stub(
            window,
            'showWarningMessage'
        );
        swm.onFirstCall().resolves('C&&onfirm');
        repository.sourceControl.inputBox.value = 'non empty message';
        await commands.executeCommand('fossil.commitWithInput');
        sinon.assert.calledOnceWithMatch(
            swm,
            'There are no staged changes, do you want to commit working changes?\n'
        );
        sinon.assert.calledOnce(commitStub);
        assert.equal(repository.sourceControl.inputBox.value, '');
    });

    test('Commit command - commit staging group with dialog', async () => {
        await commitStagedTest(this.ctx.sandbox, 'fossil.commit');
    });

    test('CommitStaged command - commit staging group with dialog', async () => {
        await commitStagedTest(this.ctx.sandbox, 'fossil.commitStaged');
    });

    test('CommitAll command - commit staging group with dialog', async () => {
        const repository = getRepository();
        await cleanupFossil(repository);
        const execStub = getExecStub(this.ctx.sandbox);
        fakeFossilStatus(execStub, 'ADDED a\nADDED b\n');
        const commitStub = execStub
            .withArgs(sinon.match.array.startsWith(['commit']))
            .resolves(fakeExecutionResult());
        await repository.updateStatus('Test' as Reason);
        assert.ok(repository.workingGroup.resourceStates[1]);
        await commands.executeCommand(
            'fossil.stage',
            repository.workingGroup.resourceStates[1]
        );
        const sib = this.ctx.sandbox
            .stub(window, 'showInputBox')
            .resolves('test message all');
        assertGroups(repository, {
            working: [
                [Uri.joinPath(rootUri, 'a').fsPath, ResourceStatus.ADDED],
            ],
            staging: [
                [Uri.joinPath(rootUri, 'b').fsPath, ResourceStatus.ADDED],
            ],
        });
        await commands.executeCommand('fossil.commitAll');
        sinon.assert.calledOnce(sib);
        sinon.assert.calledOnceWithExactly(commitStub, [
            'commit',
            '-m',
            'test message all' as FossilCommitMessage,
            '--',
        ]);
    });

    test('Commit nothing', async () => {
        const repository = getRepository();
        const execStub = getExecStub(this.ctx.sandbox);
        const statusStub = fakeFossilStatus(execStub, '\n');
        await repository.updateStatus('Test' as Reason);
        sinon.assert.calledOnce(statusStub);
        assertGroups(repository, {});

        const sim: sinon.SinonStub = this.ctx.sandbox
            .stub(window, 'showInformationMessage')
            .resolves();
        repository.sourceControl.inputBox.value = 'not committed message';
        await commands.executeCommand('fossil.commitWithInput');
        sinon.assert.calledOnceWithMatch(
            sim,
            'There are no changes to commit.'
        );
    });

    test('Commit empty message', async () => {
        const repository = getRepository();
        assertGroups(repository, {});
        const uri = Uri.joinPath(rootUri, 'empty_commit.txt');
        await fs.writeFile(uri.fsPath, 'content');

        const execStub = getExecStub(this.ctx.sandbox);
        await repository.updateStatus('Test' as Reason);
        assertGroups(repository, {
            untracked: [[uri.fsPath, ResourceStatus.EXTRA]],
        });

        const resource = repository.untrackedGroup.getResource(uri);
        assert.ok(resource);
        await commands.executeCommand('fossil.add', resource);
        assertGroups(repository, {
            staging: [[uri.fsPath, ResourceStatus.ADDED]],
        });
        const commitStub = execStub.withArgs([
            'commit',
            '-m',
            '',
            '--',
            'empty_commit.txt',
        ]);

        repository.sourceControl.inputBox.value = '';
        const sib = this.ctx.sandbox
            .stub(window, 'showInputBox')
            .withArgs(
                sinon.match({
                    prompt: 'empty check-in comment.  continue (y/N)? ',
                    ignoreFocusOut: true,
                })
            )
            .resolves('Y');
        await commands.executeCommand('fossil.commitWithInput');
        sinon.assert.calledOnce(sib);
        sinon.assert.calledOnce(commitStub);
    }).timeout(6000);

    test('Commit creating new branch', async () => {
        const branchPath = Uri.joinPath(rootUri, 'branch.txt');
        await fs.writeFile(branchPath.fsPath, 'branch content\n');

        const repository = getRepository();
        repository.sourceControl.inputBox.value = 'creating new branch';
        await repository.updateStatus('Test' as Reason);
        const resource = repository.untrackedGroup.getResource(branchPath);
        assert.ok(resource);
        await commands.executeCommand('fossil.add', resource);

        const cib = this.ctx.sandbox.stub(window, 'createInputBox');
        cib.onFirstCall().callsFake(() => {
            const inputBox: vscode.InputBox = cib.wrappedMethod();
            const stub = sinon.stub(inputBox);
            stub.show.callsFake(() => {
                stub.value = 'commit branch';
                const onDidAccept = stub.onDidAccept.getCall(0).args[0];
                onDidAccept();
            });
            return stub;
        });
        const execStub = getExecStub(this.ctx.sandbox);
        const commitStub = execStub
            .withArgs([
                'commit',
                '--branch',
                'commit branch',
                '-m',
                'creating new branch',
                '--',
                'branch.txt',
            ])
            .resolves(fakeExecutionResult());

        await commands.executeCommand('fossil.commitBranch');
        sinon.assert.calledOnce(commitStub);
    }).timeout(6000);

    test('Unsaved files warning', async () => {
        const uri1 = await add('warning1.txt', 'data', 'warning test');
        const uri2 = await add('warning2.txt', 'data', 'warning test');
        await fs.writeFile(uri1.fsPath, 'warning test');
        await fs.writeFile(uri2.fsPath, 'warning test');
        const repository = getRepository();
        await repository.updateStatus('Test' as Reason);
        const resource1 = repository.workingGroup.getResource(uri1);
        assert.ok(resource1);
        await commands.executeCommand('fossil.stage', resource1);
        await commands.executeCommand('fossil.openFiles', resource1);
        const editor1 = window.visibleTextEditors.find(
            e => e.document.uri.toString() == uri1.toString()
        );
        assert.ok(editor1);
        await editor1.edit(eb =>
            eb.insert(new vscode.Position(0, 0), 'edits\n')
        );
        repository.sourceControl.inputBox.value = 'my message';
        const swm: sinon.SinonStub = this.ctx.sandbox.stub(
            window,
            'showWarningMessage'
        );
        swm.onFirstCall().resolves();
        swm.onSecondCall().resolves('Save All & Commit');

        await commands.executeCommand('fossil.commitWithInput');
        sinon.assert.calledWithExactly(
            swm.firstCall,
            "The following file has unsaved changes which won't be " +
                'included in the commit if you proceed: warning1.txt.\n\n' +
                'Would you like to save it before committing?',
            { modal: true },
            'Save All & Commit',
            'C&&ommit Staged Changes'
        );

        const resource2 = repository.workingGroup.getResource(uri2);
        assert.ok(resource2);
        await commands.executeCommand('fossil.stage', resource2);
        await commands.executeCommand('fossil.openFiles', resource2);

        const editor2 = window.visibleTextEditors.find(
            e => e.document.uri.toString() == uri2.toString()
        );
        assert.ok(editor2);
        await editor2.edit(eb =>
            eb.insert(new vscode.Position(0, 0), 'edits\n')
        );

        await commands.executeCommand('fossil.commitWithInput');
        sinon.assert.calledWithExactly(
            swm.secondCall,
            'There are 2 unsaved files.\n\nWould you like to save them before committing?',
            { modal: true },
            'Save All & Commit',
            'C&&ommit Staged Changes'
        );
    }).timeout(10000);

    test('Conflict commit', async () => {
        const repository = getRepository();
        const execStub = getExecStub(this.ctx.sandbox);
        const statusStub = fakeFossilStatus(execStub, 'ADDED a\nCONFLICT b');
        await repository.updateStatus('Test' as Reason);
        sinon.assert.calledOnce(statusStub);
        repository.sourceControl.inputBox.value = 'must not be committed';
        const swm: sinon.SinonStub = this.ctx.sandbox
            .stub(window, 'showWarningMessage')
            .resolves();
        await commands.executeCommand('fossil.commitWithInput');
        sinon.assert.calledOnceWithExactly(
            swm,
            'Resolve conflicts before committing.'
        );
        assert.equal(
            repository.sourceControl.inputBox.value,
            'must not be committed'
        );
    });

    test('Commit missing files', async () => {
        const repository = getRepository();
        const execStub = getExecStub(this.ctx.sandbox);
        const statusStub = fakeFossilStatus(
            execStub,
            'ADDED a\nMISSING b\nMISSING c'
        );
        await repository.updateStatus('Test' as Reason);
        sinon.assert.calledOnce(statusStub);
        const swm: sinon.SinonStub = this.ctx.sandbox
            .stub(window, 'showWarningMessage')
            .withArgs(sinon.match(/^Did you want to delete/))
            .resolves('&&Delete' as any);
        await commands.executeCommand('fossil.stageAll');

        const forgetStub = execStub
            .withArgs(sinon.match.array.startsWith(['forget']))
            .resolves();
        const commitStub = execStub
            .withArgs(sinon.match.array.startsWith(['commit']))
            .resolves(fakeExecutionResult());

        repository.sourceControl.inputBox.value = 'remove files';
        await commands.executeCommand('fossil.commitWithInput');
        sinon.assert.calledOnceWithExactly(
            swm,
            'Did you want to delete 2 missing files in this commit?\n\n • b\n • c',
            { modal: true },
            '&&Delete'
        );
        sinon.assert.calledOnceWithExactly(forgetStub, [
            'forget',
            '--',
            'b' as RelativePath,
            'c' as RelativePath,
        ]);
        sinon.assert.calledOnceWithExactly(commitStub, [
            'commit',
            '-m',
            'remove files' as FossilCommitMessage,
            '--',
            'a' as RelativePath,
            'b' as RelativePath,
            'c' as RelativePath,
        ]);
    });

    test('Do not commit missing file', async () => {
        const repository = getRepository();
        const execStub = getExecStub(this.ctx.sandbox);
        const statusStub = fakeFossilStatus(execStub, 'ADDED a\nMISSING b');
        await repository.updateStatus('Test' as Reason);
        sinon.assert.calledOnce(statusStub);
        repository.sourceControl.inputBox.value = 'must not commit';
        const swm: sinon.SinonStub = this.ctx.sandbox
            .stub(window, 'showWarningMessage')
            .withArgs(sinon.match(/^Did you want to delete/))
            .resolves();
        await commands.executeCommand('fossil.stageAll');

        await commands.executeCommand('fossil.commitWithInput');
        sinon.assert.calledOnceWithExactly(
            swm,
            "Did you want to delete 'b' in this commit?",
            { modal: true },
            '&&Delete'
        );
    });

    test('Commit with specified username (user-override)', async () => {
        const configStub = stubFossilConfig(this.ctx.sandbox);
        configStub.get.withArgs('username').returns('testUsername');
        const { execStub, repository } = await singleFileCommitSetup(
            this.ctx.sandbox,
            rootUri
        );
        const commitStub = execStub
            .withArgs(sinon.match.array.startsWith(['commit']))
            .resolves(fakeExecutionResult());

        repository.sourceControl.inputBox.value = 'custom username test';
        await commands.executeCommand('fossil.commitWithInput');
        sinon.assert.calledOnceWithExactly(commitStub, [
            'commit',
            '--user-override',
            'testUsername' as FossilUsername,
            '-m',
            'custom username test' as FossilCommitMessage,
            '--',
            'minimal.txt' as RelativePath,
        ]);
    });

    test('Commit with specified defaultUsername', async () => {
        const configStub = stubFossilConfig(this.ctx.sandbox);
        configStub.get.withArgs('username').returns('newUsername');
        configStub.get.withArgs('defaultUsername').returns('defaultUsername');
        configStub.get.withArgs('globalArgs').returns(['--quiet']);

        const { repository } = await singleFileCommitSetup(
            this.ctx.sandbox,
            rootUri
        );

        const rawCommit = getRawExecStub(this.ctx.sandbox)
            .withArgs(sinon.match.array.contains(['commit']))
            .resolves(fakeRawExecutionResult({ stderr: 'lol stderr' }));
        repository.sourceControl.inputBox.value = 'custom username test2';
        await commands.executeCommand('fossil.commitWithInput');
        sinon.assert.calledOnceWithExactly(
            rawCommit as any,
            [
                '--quiet',
                '--user',
                'defaultUsername' as FossilUsername,
                'commit',
                '--user-override',
                'newUsername' as FossilUsername,
                '-m',
                'custom username test2' as FossilCommitMessage,
                '--',
                'minimal.txt' as RelativePath,
            ],
            sinon.match.object
        );
    });

    test('Commit with `commitArgs` and `globalArgs`', async () => {
        const configStub = stubFossilConfig(this.ctx.sandbox);
        configStub.get
            .withArgs('commitArgs')
            .returns(['--hash', '--ignore-clock-skew']);
        configStub.get.withArgs('globalArgs').returns(['--user', 'alex']);

        const repository = getRepository();
        const execStub = getExecStub(this.ctx.sandbox);

        const statusStub = fakeFossilStatus(execStub, 'ADDED a');
        await repository.updateStatus('Test' as Reason);
        sinon.assert.calledOnce(statusStub);
        await commands.executeCommand('fossil.stageAll');

        repository.sourceControl.inputBox.value = 'args test';
        execStub.restore();
        const rawCommit = getRawExecStub(this.ctx.sandbox)
            .withArgs(sinon.match.array.contains(['commit']))
            .resolves(fakeRawExecutionResult());

        await commands.executeCommand('fossil.commitWithInput');

        sinon.assert.calledOnceWithExactly(
            rawCommit as any,
            [
                '--user',
                'alex',
                'commit',
                '--hash',
                '--ignore-clock-skew',
                '-m',
                'args test',
                '--',
                'a',
            ],
            sinon.match.object
        );
    });
}
