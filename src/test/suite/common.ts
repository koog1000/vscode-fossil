import * as assert from 'assert/strict';
import { window, Uri } from 'vscode';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as fs from 'fs';
import { FossilExecutable, FossilCWD } from '../../fossilExecutable';
import { Model } from '../../model';
import { Repository } from '../../repository';
import { OpenedRepository } from '../../openedRepository';

export async function fossilInit(
    sandbox: sinon.SinonSandbox,
    executable: FossilExecutable
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
    if (executable.version >= [2, 18]) {
        showInputBox.onFirstCall().resolves('Test repo name');
        showInputBox.onSecondCall().resolves('Test repo description');
    }

    await vscode.commands.executeCommand('fossil.init');
    assert.ok(showSaveDialogstub.calledOnce);
    if (executable.version >= [2, 18]) {
        assert.ok(showInputBox.calledTwice);
    }
    assert.ok(
        fs.existsSync(fossilPath.fsPath),
        `Not a file: '${fossilPath.fsPath}' even though 'fossil.init' was successfully executed`
    );
    assert.ok(showInformationMessage.calledOnce);
    sandbox.restore();
}

export function getRepository(): Repository {
    const extension = vscode.extensions.getExtension('koog1000.fossil');
    assert.ok(extension);
    const model = extension.exports as Model;
    return model.repositories[0];
}

export async function fossilOpen(
    sandbox: sinon.SinonSandbox,
    executable: FossilExecutable
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
    const res = await executable.exec(rootPath.fsPath as FossilCWD, ['info']);
    assert.ok(/check-ins:\s+1\s*$/.test(res.stdout));
}

export async function add(
    filename: string,
    content: string,
    commitMessage: string,
    action: 'ADDED' | 'SKIP' = 'ADDED'
): Promise<vscode.Uri> {
    const repository = getRepository();
    const openedRepository: OpenedRepository = (repository as any).repository;

    const rootUri = vscode.workspace.workspaceFolders![0].uri;
    const fileUri = vscode.Uri.joinPath(rootUri, filename);
    await fs.promises.writeFile(fileUri.fsPath, content);
    const addRes = await openedRepository.exec(['add', filename]);
    assert.match(
        addRes.stdout.trimEnd(),
        new RegExp(`${action}\\s+${filename}`)
    );
    await openedRepository.exec(['commit', filename, '-m', commitMessage]);
    return fileUri;
}
