import * as vscode from 'vscode';
import * as sinon from 'sinon';
import {
    FossilCWD,
    FossilError,
    FossilExecutablePath,
    FossilStdOut,
    FossilStdErr,
} from '../../fossilExecutable';
import * as assert from 'assert/strict';
import { getExecutable } from './common';
import { afterEach } from 'mocha';

suite('Infrastructure', () => {
    const sandbox = sinon.createSandbox();
    afterEach(() => {
        sandbox.restore();
    });
    test('Error is thrown when executing unknown command', async () => {
        const rootUri = vscode.workspace.workspaceFolders![0].uri;
        const cwd = rootUri.fsPath as FossilCWD;
        const showErrorMessage: sinon.SinonStub = sandbox
            .stub(vscode.window, 'showErrorMessage')
            .resolves();
        const executable = getExecutable();
        await assert.rejects(executable.exec(cwd, ['fizzbuzz'] as any), {
            message: 'Failed to execute fossil',
            stderr: 'fossil: unknown command: fizzbuzz\nfossil: use "help" for more information\n',
            stdout: '',
            exitCode: 1,
            args: ['fizzbuzz'],
            fossilErrorCode: 'unknown',
            cwd: cwd,
        });
        sinon.assert.calledOnceWithExactly(
            showErrorMessage,
            'Fossil: fossil: unknown command: fizzbuzz',
            'Open Fossil Log'
        );
    });
    test('Error to string is valid', async () => {
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
        const referenceString =
            'my message {\n' +
            '  "exitCode": 0,\n' +
            '  "fossilErrorCode": "unknown",\n' +
            '  "args": [\n' +
            '    "cat"\n' +
            '  ],\n' +
            '  "stdout": "my stdout",\n' +
            '  "stderr": "my stderr",\n' +
            '  "cwd": "cwd",\n' +
            '  "fossilPath": "/bin/fossil"\n' +
            '}';
        assert.equal(TestError.toString(), referenceString);
    });
});
