import * as vscode from 'vscode';
import { Uri } from 'vscode';
import * as sinon from 'sinon';
import * as assert from 'assert/strict';
import * as fs from 'fs';
import { getRepository } from './common';

export async function fossil_undo_and_redo_warning(
    sandbox: sinon.SinonSandbox
): Promise<void> {
    const showWarningMessage: sinon.SinonStub = sandbox.stub(
        vscode.window,
        'showWarningMessage'
    );
    await vscode.commands.executeCommand('fossil.undo');
    assert.ok(
        showWarningMessage.firstCall.calledWithExactly('Nothing to undo.')
    );
    await vscode.commands.executeCommand('fossil.redo');
    assert.ok(
        showWarningMessage.secondCall.calledWithExactly('Nothing to redo.')
    );
}

export async function fossil_undo_and_redo_working(
    sandbox: sinon.SinonSandbox
): Promise<void> {
    const showWarningMessage: sinon.SinonStub = sandbox.stub(
        vscode.window,
        'showWarningMessage'
    );

    const rootUri = vscode.workspace.workspaceFolders![0].uri;
    const undoTxtPath = Uri.joinPath(rootUri, 'undo-fuarw.txt').fsPath;
    await fs.promises.writeFile(undoTxtPath, 'line\n');

    const repository = getRepository();
    await repository.updateModelState();
    assert.ok(repository.untrackedGroup.resourceStates.length == 1);

    showWarningMessage.onFirstCall().resolves('&&Delete file');

    await vscode.commands.executeCommand(
        'fossil.deleteFiles',
        repository.untrackedGroup
    );
    assert.ok(showWarningMessage.calledOnce);
    assert.ok(!fs.existsSync(undoTxtPath));

    const showInformationMessage: sinon.SinonStub = sandbox.stub(
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
}
