import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { FossilExecutable } from '../../fossilExecutable';
import * as assert from 'assert/strict';
import { toFossilUri } from '../../uri';
import { FossilCWD } from '../../fossilExecutable';
import { add, getRepository } from './common';

export async function fossil_file_log_can_diff_files(
    sandbox: sinon.SinonSandbox,
    executable: FossilExecutable
): Promise<void> {
    const rootUri = vscode.workspace.workspaceFolders![0].uri;
    const cwd = rootUri.fsPath as FossilCWD;

    await executable.exec(cwd, ['revert']);
    await executable.exec(cwd, ['clean']);
    await add(executable, 'file1.txt', 'line1\n', 'file1.txt: first');
    await add(
        executable,
        'file1.txt',
        'line1\nline2\n',
        'file1.txt: second',
        'SKIP'
    );
    await add(
        executable,
        'file1.txt',
        'line1\nline2\nline3\n',
        'file1.txt: third',
        'SKIP'
    );
    await add(executable, 'file2.txt', 'line1\n', 'file2.txt: first');
    await add(
        executable,
        'file2.txt',
        'line1\nline2\n',
        'file2.txt: second',
        'SKIP'
    );
    const file2uri = await add(
        executable,
        'file2.txt',
        'line1\nline2\nline3\n',
        'file2.txt: third',
        'SKIP'
    );
    const showQuickPick = sandbox.stub(vscode.window, 'showQuickPick');
    showQuickPick.onFirstCall().callsFake(items => {
        assert.ok(items instanceof Array);
        assert.equal(items[0].label, '$(tag) Current');
        return Promise.resolve(items[0]);
    });
    showQuickPick.onSecondCall().callsFake(items => {
        assert.ok(items instanceof Array);
        assert.equal(items[0].label, '$(circle-outline) Parent');
        return Promise.resolve(items[0]);
    });

    const repository = getRepository();

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

    await vscode.commands.executeCommand('fossil.fileLog', file2uri);
    assert.equal(showQuickPick.callCount, 2);
}

export async function fossil_can_amend_commit_message(
    sandbox: sinon.SinonSandbox,
    executable: FossilExecutable
): Promise<void> {
    const rootUri = vscode.workspace.workspaceFolders![0].uri;
    const cwd = rootUri.fsPath as FossilCWD;

    await executable.exec(cwd, ['revert']);
    await executable.exec(cwd, ['clean']);
    await add(executable, 'amend.txt', '\n', 'message to amend');

    const showQuickPick = sandbox.stub(vscode.window, 'showQuickPick');
    showQuickPick.onFirstCall().callsFake(items => {
        assert.ok(items instanceof Array);
        assert.equal(items[0].label, '$(git-branch) trunk');
        return Promise.resolve(items[0]);
    });
    showQuickPick.onSecondCall().callsFake(items => {
        assert.ok(items instanceof Array);
        assert.equal(items[1].label, '$(tag) Current');
        return Promise.resolve(items[1]);
    });
    showQuickPick.onThirdCall().callsFake(items => {
        assert.ok(items instanceof Array);
        assert.equal(items[1].label, '$(edit) Edit commit message');
        return Promise.resolve(items[1]);
    });
    const showInputBoxstub = sandbox.stub(vscode.window, 'showInputBox');
    showInputBoxstub.resolves('updated commit message');

    await vscode.commands.executeCommand('fossil.log');

    const stdout = (await executable.exec(cwd, ['info'])).stdout;
    assert.match(stdout, /updated commit message/m);
}
