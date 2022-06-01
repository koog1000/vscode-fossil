import * as assert from 'assert';
import { after, before } from 'mocha';
import {window, Uri} from 'vscode';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as fs from 'fs';
import * as path from 'path';

suite('Fossil', () => {
  before(() => {
    vscode.window.showInformationMessage('Start all tests.');
    const fossilPath = Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, '/test.fossil');
    fs.unlinkSync(fossilPath.fsPath);
  })

  after(() => {
    window.showInformationMessage('All tests done!');
  });

  test("fossil.init", async () => {
    assert.ok(vscode.workspace.workspaceFolders);
    const fossilPath = Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, '/test.fossil');
    assert.ok(!fs.existsSync(fossilPath.fsPath), `repo '${fossilPath.fsPath}' already exists`);

    const showSaveDialogstub = sinon.stub(window, 'showSaveDialog');
    showSaveDialogstub.resolves(fossilPath);

    const showInformationMessage = sinon.stub(window, 'showInformationMessage');
    showInformationMessage.resolves(undefined);

    await vscode.commands.executeCommand('fossil.init');
    assert.ok(showSaveDialogstub.calledOnce);
    assert.ok(fs.existsSync(fossilPath.fsPath), `Not a file: '${fossilPath.fsPath}'`);
    assert.ok(showInformationMessage.calledOnce);
    showSaveDialogstub.restore();


  });
});
