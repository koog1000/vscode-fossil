import * as vscode from 'vscode';
import * as sinon from 'sinon';
import {
    FossilCWD,
    FossilExecutablePath,
    FossilStdOut,
    FossilStdErr,
    ExecFailure,
    toString as ExecFailureToString,
} from '../../fossilExecutable';
import * as assert from 'assert/strict';
import { getExecutable } from './common';
import { after, afterEach, before } from 'mocha';
import { Old, ageFromNow } from '../../humanise';

suite('Infrastructure', () => {
    const sandbox = sinon.createSandbox();
    afterEach(() => {
        sandbox.restore();
    });
    test('Error is not thrown when executing unknown command', async () => {
        const rootUri = vscode.workspace.workspaceFolders![0].uri;
        const cwd = rootUri.fsPath as FossilCWD;
        const showErrorMessage: sinon.SinonStub = sandbox
            .stub(vscode.window, 'showErrorMessage')
            .resolves();
        const executable = getExecutable();
        const result = await executable.exec(cwd, ['fizzbuzz'] as any);
        const fossilPath = (executable as any).fossilPath as string;
        assert.deepEqual(result, {
            message: 'Failed to execute fossil',
            stderr: (`${fossilPath}: unknown command: fizzbuzz\n` +
                `${fossilPath}: use "help" for more information\n`) as FossilStdErr,
            stdout: '' as FossilStdOut,
            exitCode: 1,
            args: ['fizzbuzz' as any],
            fossilErrorCode: 'unknown',
            cwd: cwd,
            fossilPath: (executable as any).fossilPath,
            toString: ExecFailureToString,
        });
        sinon.assert.calledOnceWithExactly(
            showErrorMessage,
            `Fossil: ${fossilPath}: unknown command: fizzbuzz`,
            'Open Fossil Log'
        );
    });
    test('Error to string is valid', async () => {
        const TestError = {
            message: 'my message',
            stdout: 'my stdout' as FossilStdOut,
            stderr: 'my stderr' as FossilStdErr,
            exitCode: 1,
            fossilErrorCode: 'unknown',
            args: ['cat'],
            cwd: 'cwd' as FossilCWD,
            fossilPath: '/bin/fossil' as FossilExecutablePath,
            toString: ExecFailureToString,
        } as ExecFailure;
        const referenceString =
            'my message {\n' +
            '  "stdout": "my stdout",\n' +
            '  "stderr": "my stderr",\n' +
            '  "exitCode": 1,\n' +
            '  "fossilErrorCode": "unknown",\n' +
            '  "args": [\n' +
            '    "cat"\n' +
            '  ],\n' +
            '  "cwd": "cwd",\n' +
            '  "fossilPath": "/bin/fossil"\n' +
            '}';
        assert.equal(TestError.toString(), referenceString);
    });

    suite('ageFromNow', function () {
        const N = 1686899727000; // 2023-06-16T07:15:27.000Z friday
        const minutes = (n: number) => new Date(N + n * 60000);
        const days = (n: number) => minutes(n * 24 * 60);
        let fakeTimers: sinon.SinonFakeTimers;

        before(() => {
            fakeTimers = sinon.useFakeTimers(N);
        });
        after(() => {
            fakeTimers.restore();
        });
        test('Now', () => {
            assert.equal(ageFromNow(new Date()), 'now');
        });
        test('Now - 12 seconds', () => {
            assert.equal(ageFromNow(minutes(-0.2)), 'a few moments ago');
        });
        test('Now - 30 seconds', () => {
            assert.equal(ageFromNow(minutes(-0.5)), '30 seconds ago');
        });
        test('Now - 1 minute', () => {
            assert.equal(ageFromNow(minutes(-1)), '60 seconds ago');
        });
        test('Now - 2 minutes', () => {
            assert.equal(ageFromNow(minutes(-2)), '2 minutes ago');
        });
        test('Now - 10 minute', () => {
            assert.equal(ageFromNow(minutes(-10)), '10 minutes ago');
        });
        test('Now - 1 hour', () => {
            assert.equal(ageFromNow(minutes(-60)), '1 hour ago');
        });
        test('Now - 23.5 hour', () => {
            assert.equal(ageFromNow(minutes(-23.5 * 60)), 'yesterday');
        });
        test('Now - 1 day', () => {
            assert.equal(ageFromNow(days(-1)), 'yesterday');
        });
        test('Now - 2 days', () => {
            assert.equal(ageFromNow(days(-2)), '2 days ago');
        });
        test('Now - 3 days', () => {
            assert.equal(ageFromNow(days(-3)), '3 days ago');
        });
        test('Now - 6 days', () => {
            assert.equal(ageFromNow(days(-6)), 'last week');
        });
        test('Now - 7 days', () => {
            assert.equal(ageFromNow(days(-7)), '6/9/2023');
        });
        test('Long ago is empty string', () => {
            assert.equal(ageFromNow(days(-30), Old.EMPTY_STRING), '');
        });
        test('Now + 1 minute', () => {
            assert.equal(ageFromNow(minutes(1)), 'future (1 minute)');
        });
        test('Now + 1 day', () => {
            assert.equal(ageFromNow(days(1)), 'future (24 hours)');
        });
        test('Now + 7 days', () => {
            assert.equal(ageFromNow(days(7)), 'future (7 days)');
        });
        test('Now + one year', () => {
            assert.equal(ageFromNow(days(366)), 'future (366 days)');
        });
    });
});
