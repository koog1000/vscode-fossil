import * as vscode from 'vscode';
import { Uri } from 'vscode';
import * as sinon from 'sinon';
import * as assert from 'assert/strict';
import * as fs from 'fs';
import { getRepository } from './common';
import { Suite } from 'mocha';

function undoSuite(this: Suite) {
    test('Undo and redo warning', async () => {
        const showWarningMessage: sinon.SinonStub = this.ctx.sandbox.stub(
            vscode.window,
            'showWarningMessage'
        );
        await vscode.commands.executeCommand('fossil.undo');
        sinon.assert.calledOnce(showWarningMessage);
        sinon.assert.calledWithExactly(
            showWarningMessage.firstCall,
            'Nothing to undo.'
        );
        await vscode.commands.executeCommand('fossil.redo');
        sinon.assert.calledTwice(showWarningMessage);
        sinon.assert.calledWithExactly(
            showWarningMessage.secondCall,
            'Nothing to redo.'
        );
    }).timeout(2000);
    test('Undo and redo working', async () => {
        const showWarningMessage: sinon.SinonStub = this.ctx.sandbox.stub(
            vscode.window,
            'showWarningMessage'
        );

        const rootUri = vscode.workspace.workspaceFolders![0].uri;
        const undoTxtPath = Uri.joinPath(rootUri, 'undo-fuarw.txt').fsPath;
        await fs.promises.writeFile(undoTxtPath, 'line\n');

        const repository = getRepository();
        await repository.updateModelState();
        assert.equal(repository.untrackedGroup.resourceStates.length, 1);

        showWarningMessage.onFirstCall().resolves('&&Delete file');

        await vscode.commands.executeCommand(
            'fossil.deleteFiles',
            repository.untrackedGroup
        );
        assert.ok(showWarningMessage.calledOnce);
        assert.ok(!fs.existsSync(undoTxtPath));

        const showInformationMessage: sinon.SinonStub = this.ctx.sandbox.stub(
            vscode.window,
            'showInformationMessage'
        );

        showInformationMessage.onFirstCall().resolves('Undo');
        await vscode.commands.executeCommand('fossil.undo');
        assert.ok(fs.existsSync(undoTxtPath));
        assert.equal(
            showInformationMessage.firstCall.args[0],
            `Undo 'fossil clean ${undoTxtPath}'?`
        );

        showInformationMessage.onSecondCall().resolves('Redo');
        await vscode.commands.executeCommand('fossil.redo');
        assert.ok(!fs.existsSync(undoTxtPath));
        assert.equal(
            showInformationMessage.secondCall.args[0],
            `Redo 'fossil clean ${undoTxtPath}'?`
        );
    }).timeout(2000);
}

export function utilitiesSuite(this: Suite): void {
    suite('Undo', undoSuite.bind(this));
    test('Show output', async () => {
        await vscode.commands.executeCommand('fossil.showOutput');
        // currently there is no way to validate fossil.showOutput
    });
    test('Open UI', async () => {
        const sendText = sinon.stub();
        const terminal = {
            sendText: sendText as unknown,
        } as vscode.Terminal;
        const createTerminalstub = this.ctx.sandbox
            .stub(vscode.window, 'createTerminal')
            .returns(terminal);
        await vscode.commands.executeCommand('fossil.openUI');
        sinon.assert.calledOnce(createTerminalstub);
        sinon.assert.calledOnceWithExactly(sendText, 'fossil ui', true);
    });
}
