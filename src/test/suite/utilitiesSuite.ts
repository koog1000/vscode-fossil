import * as vscode from 'vscode';
import { Uri } from 'vscode';
import * as sinon from 'sinon';
import * as assert from 'assert/strict';
import * as fs from 'fs';
import {
    assertGroups,
    getExecStub,
    getExecutable,
    getRepository,
} from './common';
import { Suite, afterEach, beforeEach } from 'mocha';
import { debounce, memoize, sequentialize, throttle } from '../../decorators';
import { delay } from '../../util';
import { DocumentFsPath, Reason } from '../../fossilExecutable';
import { ResourceStatus } from '../../openedRepository';

function undoSuite(this: Suite) {
    test('Undo and redo warning', async () => {
        const showWarningMessage: sinon.SinonStub = this.ctx.sandbox.stub(
            vscode.window,
            'showWarningMessage'
        );
        await vscode.commands.executeCommand('fossil.undo');
        sinon.assert.calledOnce(showWarningMessage);
        sinon.assert.calledWithExactly(
            showWarningMessage.firstCall,
            'Nothing to undo.'
        );
        await vscode.commands.executeCommand('fossil.redo');
        sinon.assert.calledTwice(showWarningMessage);
        sinon.assert.calledWithExactly(
            showWarningMessage.secondCall,
            'Nothing to redo.'
        );
    }).timeout(2000);
    test('Undo and redo working', async () => {
        const showWarningMessage: sinon.SinonStub = this.ctx.sandbox.stub(
            vscode.window,
            'showWarningMessage'
        );

        const rootUri = vscode.workspace.workspaceFolders![0].uri;
        const undoTxtPath = Uri.joinPath(rootUri, 'undo-fuarw.txt')
            .fsPath as DocumentFsPath;
        await fs.promises.writeFile(undoTxtPath, 'line\n');

        const repository = getRepository();
        const execStub = getExecStub(this.ctx.sandbox);

        await repository.updateStatus('Test' as Reason);
        assertGroups(repository, {
            untracked: [[undoTxtPath, ResourceStatus.EXTRA]],
        });

        showWarningMessage.onFirstCall().resolves('&&Delete file');

        assert.ok(fs.existsSync(undoTxtPath));
        await vscode.commands.executeCommand(
            'fossil.deleteFiles',
            repository.untrackedGroup
        );
        sinon.assert.calledOnceWithExactly(
            showWarningMessage,
            'Are you sure you want to DELETE undo-fuarw.txt?\n' +
                'This is IRREVERSIBLE!\n' +
                'This file will be FOREVER LOST if you proceed.',
            { modal: true },
            '&&Delete file'
        );
        sinon.assert.calledWithExactly(execStub, ['clean', undoTxtPath]);
        assert.ok(!fs.existsSync(undoTxtPath));

        const showInformationMessage: sinon.SinonStub = this.ctx.sandbox.stub(
            vscode.window,
            'showInformationMessage'
        );

        showInformationMessage.onFirstCall().resolves('Undo');
        await vscode.commands.executeCommand('fossil.undo');
        assert.ok(fs.existsSync(undoTxtPath));
        const executable = getExecutable();
        const fossilPath = (executable as any).fossilPath as string;
        assert.equal(
            showInformationMessage.firstCall.args[0],
            `Undo '${fossilPath} clean ${undoTxtPath}'?`
        );

        showInformationMessage.onSecondCall().resolves('Redo');
        await vscode.commands.executeCommand('fossil.redo');
        assert.ok(!fs.existsSync(undoTxtPath));
        assert.equal(
            showInformationMessage.secondCall.args[0],
            `Redo '${fossilPath} clean ${undoTxtPath}'?`
        );
    }).timeout(7000);
}

function decoratorsSuite(this: Suite) {
    let fakeTimers: sinon.SinonFakeTimers;
    const startTimeStamp = new Date('2024-03-13T00:00:00Z').getTime();

    beforeEach(() => {
        fakeTimers = sinon.useFakeTimers(startTimeStamp);
    });
    afterEach(() => {
        // assert.equal(fakeTimers.countTimers(), 0, 'All timers must run');
        fakeTimers.restore();
    });

    test('Memoize', async () => {
        class MemoizeTest {
            constructor(
                public memoize_count_a = 0,
                public memoize_count_b = 0
            ) {}
            @memoize
            public get memoized_property_a(): Uri {
                ++this.memoize_count_a;
                return Uri.file('memoize_a.txt');
            }
            @memoize
            public get memoized_property_b(): Uri {
                ++this.memoize_count_b;
                return Uri.file('memoize_b.txt');
            }
            public get counts(): [number, number] {
                return [this.memoize_count_a, this.memoize_count_b];
            }
        }
        const dt = new MemoizeTest();
        assert.equal(dt.memoized_property_a.fsPath, '/memoize_a.txt');
        assert.deepStrictEqual(dt.counts, [1, 0]);
        assert.equal(dt.memoized_property_a.fsPath, '/memoize_a.txt');
        assert.deepStrictEqual(dt.counts, [1, 0]);
        assert.equal(dt.memoized_property_b.fsPath, '/memoize_b.txt');
        assert.deepStrictEqual(dt.counts, [1, 1]);
        assert.equal(dt.memoized_property_b.fsPath, '/memoize_b.txt');
        assert.deepStrictEqual(dt.counts, [1, 1]);
        assert.equal(dt.memoized_property_a.fsPath, '/memoize_a.txt');
        assert.deepStrictEqual(dt.counts, [1, 1]);
    });
    test('Throttle', async () => {
        class ThrottledTest {
            constructor(public throttle_count = 0) {}
            @throttle
            async throttled_method(key: string): Promise<string> {
                await delay(25);
                return `${key}-${this.throttle_count++}`;
            }
        }
        const dt = new ThrottledTest();
        assert.equal(fakeTimers.countTimers(), 0);
        const p0 = dt.throttled_method('a');
        const p1 = dt.throttled_method('b');
        const p2 = dt.throttled_method('c');
        assert.equal(fakeTimers.countTimers(), 1);
        const resPromise = Promise.all([p0, p1, p2]);
        await fakeTimers.runAllAsync();
        assert.equal(fakeTimers.countTimers(), 0);
        assert.deepStrictEqual(await resPromise, ['a-0', 'b-1', 'b-1']);
        assert.equal(fakeTimers.countTimers(), 0);
        assert.equal(dt.throttle_count, 2);
    });
    test('Sequentialize', async () => {
        class SequentializeTest {
            constructor(public sequentialize_count = 0) {}
            @sequentialize
            async sequentialized_method(
                ms: number,
                key: string
            ): Promise<string> {
                await delay(ms);
                return `${key}-${this.sequentialize_count++}`;
            }
        }

        const dt = new SequentializeTest();
        const p0 = dt.sequentialized_method(50, 'a');
        const p1 = dt.sequentialized_method(20, 'b');
        const p2 = dt.sequentialized_method(10, 'c');
        const resPromise = Promise.race([p0, p1, p2]);
        assert.equal(fakeTimers.countTimers(), 0);
        await fakeTimers.runAllAsync();
        assert.deepStrictEqual(await resPromise, 'a-0');
        assert.equal(fakeTimers.countTimers(), 0);
        assert.equal(dt.sequentialize_count, 3);
        assert.deepStrictEqual(await p1, 'b-1');
        assert.deepStrictEqual(await p2, 'c-2');
    });
    test('Debounce', async () => {
        class DebounceTest {
            constructor(public debounce_count = 0) {}
            @debounce(50)
            debounced_method(): void {
                this.debounce_count++;
            }
        }

        const dt = new DebounceTest();
        assert.equal(fakeTimers.countTimers(), 0);
        const p0 = dt.debounced_method();
        assert.equal(fakeTimers.countTimers(), 1);
        const p1 = dt.debounced_method();
        const p2 = dt.debounced_method();
        const resPromise = Promise.all([p0, p1, p2]);
        assert.equal(fakeTimers.countTimers(), 1);
        const debounceTimer = fakeTimers.next();
        assert.deepEqual(await resPromise, [undefined, undefined, undefined]);
        assert.equal(fakeTimers.countTimers(), 0);
        assert.equal(debounceTimer, startTimeStamp + 50, 'main timer worked');
        assert.equal(dt.debounce_count, 1, 'reached main timer only');
    });
}

export function utilitiesSuite(this: Suite): void {
    suite('Undo', undoSuite.bind(this));
    suite('Decorators', decoratorsSuite.bind(this));
    test('Show output', async () => {
        await vscode.commands.executeCommand('fossil.showOutput');
        // currently there is no way to validate fossil.showOutput
    });
    test('Open UI', async () => {
        const sendText = sinon.stub();
        const terminal = {
            sendText: sendText as unknown,
        } as vscode.Terminal;
        const createTerminalStub = this.ctx.sandbox
            .stub(vscode.window, 'createTerminal')
            .returns(terminal);
        await vscode.commands.executeCommand('fossil.openUI');
        sinon.assert.calledOnce(createTerminalStub);
        sinon.assert.calledOnceWithExactly(sendText, 'fossil ui');
    });
    test('Commit input box knows which repository to use', () => {
        const repository = getRepository();
        assert.deepStrictEqual(repository.sourceControl.acceptInputCommand, {
            command: 'fossil.commitWithInput',
            title: 'Commit',
            arguments: [repository],
        });
    });
}
