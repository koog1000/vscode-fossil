import * as assert from 'assert/strict';
import { window, Uri } from 'vscode';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as fs from 'fs';
import { Fossil, FossilCWD } from '../../fossilBase';

export async function fossilInit(
    sandbox: sinon.SinonSandbox,
    fossil: Fossil
): Promise<void> {
    assert.ok(vscode.workspace.workspaceFolders);
    const fossilPath = Uri.joinPath(
        vscode.workspace.workspaceFolders![0].uri,
        '/test.fossil'
    );
    assert.ok(
        !fs.existsSync(fossilPath.fsPath),
        `repo '${fossilPath.fsPath}' already exists`
    );

    const showSaveDialogstub = sandbox.stub(window, 'showSaveDialog');
    showSaveDialogstub.resolves(fossilPath);

    const showInformationMessage = sandbox.stub(
        window,
        'showInformationMessage'
    ); // this one asks to open created repository
    showInformationMessage.resolves(undefined);

    const showInputBox = sandbox.stub(window, 'showInputBox');
    if (fossil.version >= [2, 18]) {
        showInputBox.onFirstCall().resolves('Test repo name');
        showInputBox.onSecondCall().resolves('Test repo description');
    }

    await vscode.commands.executeCommand('fossil.init');
    assert.ok(showSaveDialogstub.calledOnce);
    if (fossil.version >= [2, 18]) {
        assert.ok(showInputBox.calledTwice);
    }
    assert.ok(
        fs.existsSync(fossilPath.fsPath),
        `Not a file: '${fossilPath.fsPath}' even though 'fossil.init' was sucessfully executed`
    );
    assert.ok(showInformationMessage.calledOnce);
    sandbox.restore();
}

export async function fossilOpen(
    sandbox: sinon.SinonSandbox,
    fossil: Fossil
): Promise<void> {
    assert.ok(vscode.workspace.workspaceFolders);
    const rootPath = vscode.workspace.workspaceFolders![0].uri;
    const fossilPath = Uri.joinPath(rootPath, '/test.fossil');
    assert.ok(
        fs.existsSync(fossilPath.fsPath),
        `repo '${fossilPath.fsPath}' must exist`
    );

    const showInformationMessage = sandbox.stub(window, 'showOpenDialog');
    showInformationMessage.onFirstCall().resolves([fossilPath]);
    showInformationMessage.onSecondCall().resolves([rootPath]);

    await vscode.commands.executeCommand('fossil.open');
    const res = await fossil.exec(rootPath.fsPath as FossilCWD, ['info']);
    assert.ok(/check-ins:\s+1\s*$/.test(res.stdout));
}
