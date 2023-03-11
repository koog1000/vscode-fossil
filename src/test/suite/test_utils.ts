import * as vscode from 'vscode';
import * as sinon from 'sinon';
import {
    FossilExecutable,
    FossilCWD,
    FossilError,
    FossilExecutablePath,
    FossilStdOut,
    FossilStdErr,
} from '../../fossilExecutable';
import * as assert from 'assert/strict';

export async function error_is_thrown_when_executing_unknown_command(
    sandbox: sinon.SinonSandbox,
    executable: FossilExecutable
): Promise<void> {
    const rootUri = vscode.workspace.workspaceFolders![0].uri;
    const cwd = rootUri.fsPath as FossilCWD;
    const showErrorMessage = sandbox.stub(vscode.window, 'showErrorMessage');
    showErrorMessage.resolves(undefined);
    await assert.rejects(executable.exec(cwd, ['fizzbuzz'] as any), {
        message: 'Failed to execute fossil',
        stderr: 'fossil: unknown command: fizzbuzz\nfossil: use "help" for more information\n',
        stdout: '',
        exitCode: 1,
        args: ['fizzbuzz'],
        fossilErrorCode: 'unknown',
        cwd: cwd,
    });
    assert.ok(showErrorMessage.calledOnce);

    const TestError = new FossilError({
        message: 'my message',
        stdout: 'my stdout' as FossilStdOut,
        stderr: 'my stderr' as FossilStdErr,
        exitCode: 0,
        fossilErrorCode: 'unknown',
        args: ['cat'],
        cwd: 'cwd' as FossilCWD,
        fossilPath: '/bin/fossil' as FossilExecutablePath,
    });
    const referenceString = `my message {
  "exitCode": 0,
  "fossilErrorCode": "unknown",
  "args": [
    "cat"
  ],
  "stdout": "my stdout",
  "stderr": "my stderr",
  "cwd": "cwd",
  "fossilPath": "/bin/fossil"
}`;
    assert.equal(TestError.toString(), referenceString);
}
