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
import { after, afterEach, before } from 'mocha';
import { Old, ageFromNow } from '../../humanise';

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
        test('Now + 1 day', () => {
            assert.equal(ageFromNow(days(10)), 'now');
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
    });
});
