import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { Fossil, FossilCWD } from '../../fossilBase';
import { fossilInit, fossilOpen } from './common';
import * as assert from 'assert/strict';
import * as fs from 'fs/promises';
import { toFossilUri } from '../../uri';
import { Model } from '../../model';

async function add(
    fossil: Fossil,
    filename: string,
    content: string,
    message: string
): Promise<vscode.Uri> {
    const rootUri = vscode.workspace.workspaceFolders![0].uri;
    const cwd = rootUri.fsPath as FossilCWD;
    const fileUri = vscode.Uri.joinPath(rootUri, filename);
    await fs.writeFile(fileUri.fsPath, content);
    await fossil.exec(cwd, ['add', filename]);
    await fossil.exec(cwd, ['commit', filename, '-m', message]);
    return fileUri;
}

export async function fossil_file_log_can_diff_files(
    sandbox: sinon.SinonSandbox,
    fossil: Fossil
): Promise<void> {
    await fossilInit(sandbox, fossil);
    await fossilOpen(sandbox, fossil);
    await add(fossil, 'file1.txt', 'line1\n', 'file1.txt: first');
    await add(fossil, 'file1.txt', 'line1\nline2\n', 'file1.txt: second');
    await add(fossil, 'file1.txt', 'line1\nline2\nline3\n', 'file1.txt: third');
    await add(fossil, 'file2.txt', 'line1\n', 'file2.txt: first');
    await add(fossil, 'file2.txt', 'line1\nline2\n', 'file2.txt: second');
    const file2uri = await add(
        fossil,
        'file2.txt',
        'line1\nline2\nline3\n',
        'file2.txt: third'
    );
    const showQuickPick = sandbox.stub(vscode.window, 'showQuickPick');
    showQuickPick.onFirstCall().callsFake(items => {
        if (items instanceof Array) {
            assert.equal(items[0].label, '$(tag) Current');
            return Promise.resolve(items[0]);
        }
        assert.fail();
    });
    showQuickPick.onSecondCall().callsFake(items => {
        if (items instanceof Array) {
            assert.equal(items[0].label, '$(circle-outline) Parent');
            return Promise.resolve(items[0]);
        }
        assert.fail();
    });

    const model = vscode.extensions.getExtension('koog1000.fossil')!
        .exports as Model;
    const repository = model.repositories[0];

    const executeCommand = sandbox.stub(vscode.commands, 'executeCommand');
    executeCommand
        .withArgs('vscode.diff')
        .callsFake(
            async (
                command: string,
                left: vscode.Uri,
                right: vscode.Uri,
                title: string,
                _opts: unknown
            ): Promise<unknown> => {
                const parentHash = await repository.getInfo(
                    'current',
                    'parent'
                );
                assert.deepEqual(left, toFossilUri(file2uri, 'current'));
                assert.deepEqual(right, toFossilUri(file2uri, parentHash));
                assert.equal(
                    title,
                    `file2.txt (current vs. ${parentHash.slice(0, 12)})`
                );
                return Promise.resolve();
            }
        );
    executeCommand.callThrough();
    // callsFake()

    await vscode.commands.executeCommand('fossil.fileLog', file2uri);
    assert.equal(showQuickPick.callCount, 2);
}
