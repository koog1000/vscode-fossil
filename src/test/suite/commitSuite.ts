import * as vscode from 'vscode';
import { Uri, window, workspace, commands } from 'vscode';
import * as sinon from 'sinon';
import {
    add,
    cleanupFossil,
    fakeExecutionResult,
    fakeFossilStatus,
    getExecStub,
    getRepository,
} from './common';
import * as assert from 'assert/strict';
import * as fs from 'fs/promises';
import { Suite, before, beforeEach } from 'mocha';

export function CommitSuite(this: Suite): void {
    const clearInputBox = () => {
        const repository = getRepository();
        repository.sourceControl.inputBox.value = '';
    };
    before(clearInputBox);
    beforeEach(clearInputBox);

    test('Commit using input box', async () => {
        const repository = getRepository();
        const execStub = getExecStub(this.ctx.sandbox);
        const statusStub = fakeFossilStatus(execStub, 'ADDED fake.txt\n');
        await repository.updateModelState();
        sinon.assert.calledOnce(statusStub);
        assert.equal(repository.workingGroup.resourceStates.length, 1);
        const commitStub = execStub
            .withArgs(['commit', 'fake.txt', '-m', 'non empty message'])
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

    const commitStagedTest = async (
        command: 'fossil.commit' | 'fossil.commitStaged'
    ) => {
        const repository = getRepository();
        assert.equal(
            repository.sourceControl.inputBox.value,
            '',
            'empty input box'
        );
        const execStub = getExecStub(this.ctx.sandbox);
        const statusStub = fakeFossilStatus(execStub, 'ADDED a\nADDED b\n');
        const commitStub = execStub
            .withArgs(sinon.match.array.startsWith(['commit']))
            .resolves(fakeExecutionResult());
        await repository.updateModelState();
        await commands.executeCommand('fossil.stageAll');
        const sib = this.ctx.sandbox
            .stub(window, 'showInputBox')
            .resolves('test message');
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
            'a',
            'b',
            '-m',
            'test message',
        ]);
    };

    test('Commit command - commit staging group with dialog', async () => {
        await commitStagedTest('fossil.commit');
    });

    test('CommitStaged command - commit staging group with dialog', async () => {
        await commitStagedTest('fossil.commitStaged');
    });

    test('CommitAll command - commit staging group with dialog', async () => {
        const repository = getRepository();
        await cleanupFossil(repository);
        const execStub = getExecStub(this.ctx.sandbox);
        fakeFossilStatus(execStub, 'ADDED a\nADDED b\n');
        const commitStub = execStub
            .withArgs(sinon.match.array.startsWith(['commit']))
            .resolves(fakeExecutionResult());
        await repository.updateModelState();
        assert.ok(repository.workingGroup.resourceStates[1]);
        await commands.executeCommand(
            'fossil.stage',
            repository.workingGroup.resourceStates[1]
        );
        const sib = this.ctx.sandbox
            .stub(window, 'showInputBox')
            .resolves('test message all');
        assert.equal(repository.workingGroup.resourceStates.length, 1);
        assert.equal(repository.stagingGroup.resourceStates.length, 1);
        await commands.executeCommand('fossil.commitAll');
        sinon.assert.calledOnce(sib);
        sinon.assert.calledOnceWithExactly(commitStub, [
            'commit',
            '-m',
            'test message all',
        ]);
    });

    test('Commit nothing', async () => {
        const repository = getRepository();
        const execStub = getExecStub(this.ctx.sandbox);
        const statusStub = fakeFossilStatus(execStub, '\n');
        await repository.updateModelState();
        sinon.assert.calledOnce(statusStub);
        assert.equal(repository.workingGroup.resourceStates.length, 0);

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
        const uri = Uri.joinPath(
            workspace.workspaceFolders![0].uri,
            'empty_commit.txt'
        );
        await fs.writeFile(uri.fsPath, 'content');

        const execStub = getExecStub(this.ctx.sandbox);
        await repository.updateModelState();
        const resource = repository.untrackedGroup.getResource(uri);

        await commands.executeCommand('fossil.add', resource);
        assert.equal(repository.stagingGroup.resourceStates.length, 1);
        const commitStub = execStub.withArgs([
            'commit',
            'empty_commit.txt',
            '-m',
            '',
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
        const rootUri = workspace.workspaceFolders![0].uri;
        const branchPath = Uri.joinPath(rootUri, 'branch.txt');
        await fs.writeFile(branchPath.fsPath, 'branch content\n');

        const repository = getRepository();
        repository.sourceControl.inputBox.value = 'creating new branch';
        await repository.updateModelState();
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
                'branch.txt',
                '-m',
                'creating new branch',
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
        await repository.updateModelState();
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
        await repository.updateModelState();
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
        await repository.updateModelState();
        sinon.assert.calledOnce(statusStub);
        repository.sourceControl.inputBox.value = 'remove files';
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

        await commands.executeCommand('fossil.commitWithInput');
        sinon.assert.calledOnceWithExactly(
            swm,
            'Did you want to delete 2 missing files in this commit?\n\n • b\n • c',
            { modal: true },
            '&&Delete'
        );
        sinon.assert.calledOnceWithExactly(forgetStub, ['forget', 'b', 'c']);
        sinon.assert.calledOnceWithExactly(commitStub, [
            'commit',
            'a',
            'b',
            'c',
            '-m',
            'remove files',
        ]);
    });

    test('Do not commit missing file', async () => {
        const repository = getRepository();
        const execStub = getExecStub(this.ctx.sandbox);
        const statusStub = fakeFossilStatus(execStub, 'ADDED a\nMISSING b');
        await repository.updateModelState();
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
}
