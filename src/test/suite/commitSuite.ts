import * as vscode from 'vscode';
import { Uri, window, workspace, commands } from 'vscode';
import * as sinon from 'sinon';
import { add, fakeFossilStatus, getExecStub, getRepository } from './common';
import * as assert from 'assert/strict';
import * as fs from 'fs/promises';
import { Suite } from 'mocha';

export function CommitSuite(this: Suite): void {
    test('Commit using input box', async () => {
        const repository = getRepository();
        const execStub = getExecStub(this.ctx.sandbox);
        const statusStub = fakeFossilStatus(execStub, 'ADDED fake.txt\n');
        await repository.updateModelState();
        sinon.assert.calledOnce(statusStub);
        assert.equal(repository.workingGroup.resourceStates.length, 1);
        const commitStub = execStub
            .withArgs(['commit', 'fake.txt', '-m', 'non empty message'])
            .resolves();

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
        repository.sourceControl.inputBox.value = 'non empty message';
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
        const sib = this.ctx.sandbox.stub(window, 'showInputBox').resolves('Y');
        await commands.executeCommand('fossil.commitWithInput');
        sinon.assert.calledOnceWithMatch(sib, {
            prompt: 'empty check-in comment.  continue (y/N)? ',
            ignoreFocusOut: true,
        });
        sinon.assert.calledOnce(commitStub);
    });

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
            .resolves();

        await commands.executeCommand('fossil.commitBranch');
        sinon.assert.calledOnce(commitStub);
    });

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
    });
}
