import { window, commands } from 'vscode';
import * as sinon from 'sinon';
import {
    fakeExecutionResult,
    fakeFossilBranch,
    fakeFossilChanges,
    fakeFossilStatus,
    fakeRawExecutionResult,
    fakeUpdateResult,
    getExecStub,
    getModel,
    getRawExecStub,
    getRepository,
    statusBarCommands,
    stubFossilConfig,
} from './common';
import * as assert from 'assert/strict';
import { Suite, after, before } from 'mocha';
import { Reason } from '../../fossilExecutable';

export function StatusBarSuite(this: Suite): void {
    let fakeTimers: sinon.SinonFakeTimers;
    const N = new Date('2024-11-23T16:51:31.000Z');

    before(() => {
        fakeTimers = sinon.useFakeTimers({
            now: N,
            shouldClearNativeTimers: true,
        });
    });

    after(() => {
        fakeTimers.restore();
    });

    test('Status Bar Exists', async () => {
        const [branchBar, syncBar] = statusBarCommands();
        assert.equal(branchBar.command, 'fossil.branchChange');
        assert.equal(branchBar.title, '$(git-branch) trunk');
        assert.equal(branchBar.tooltip?.split('\n').pop(), 'Change Branch...');
        assert.deepEqual(branchBar.arguments, [getRepository()]);
        assert.equal(syncBar.command, 'fossil.update');
        assert.equal(syncBar.title, '$(sync)');
        assert.ok(syncBar.tooltip);
        assert.match(
            syncBar.tooltip,
            /^Next sync \d\d:\d\d:\d\d\nNone\. Already up-to-date\nUpdate$/
        );
        assert.deepEqual(syncBar.arguments, [getRepository()]);
    });

    test('Sync', async () => {
        const execStub = getExecStub(this.ctx.sandbox);
        const syncCall = execStub
            .withArgs(['sync'])
            .resolves(fakeExecutionResult());
        const changesCall = fakeFossilChanges(execStub, '18 files modified.');
        await commands.executeCommand('fossil.sync');
        sinon.assert.calledOnceWithExactly(syncCall, ['sync']);
        sinon.assert.calledOnceWithExactly(
            changesCall,
            ['update', '--dry-run'],
            'Triggered by previous operation' as Reason,
            { logErrors: false }
        );
        const nextSyncString = new Date(N.getTime() + 3 * 60 * 1000)
            .toTimeString()
            .split(' ')[0];

        const syncBar = statusBarCommands()[1];
        assert.equal(syncBar.title, '$(sync) 18');
        assert.equal(
            syncBar.tooltip,
            `Next sync ${nextSyncString}\n18 files modified.\nUpdate`
        );
    });

    test('Icon spins when sync is in progress', async () => {
        const execStub = getExecStub(this.ctx.sandbox);
        const syncStub = execStub.withArgs(['sync']).callsFake(async () => {
            const syncBar = statusBarCommands()[1];
            assert.equal(syncBar.title, '$(sync~spin)');
            return fakeExecutionResult();
        });
        const changeStub = fakeFossilChanges(
            execStub,
            'None. Already up-to-date'
        );
        await commands.executeCommand('fossil.sync');
        sinon.assert.calledOnce(syncStub);
        sinon.assert.calledOnce(changeStub);
        sinon.assert.calledTwice(execStub);
    });

    test('Icon spins when update is in progress', async () => {
        const execStub = getExecStub(this.ctx.sandbox);
        const syncStub = execStub.withArgs(['update']).callsFake(async () => {
            const syncBar = statusBarCommands()[1];
            assert.equal(syncBar.title, '$(sync~spin)');
            return fakeUpdateResult();
        });
        const changeStub = fakeFossilChanges(
            execStub,
            'None. Already up-to-date'
        );
        const statusStub = fakeFossilStatus(execStub, '');
        const branchStub = fakeFossilBranch(execStub, 'trunk');
        await commands.executeCommand('fossil.update');
        sinon.assert.calledOnce(syncStub);
        sinon.assert.notCalled(changeStub);
        sinon.assert.calledOnce(statusStub);
        sinon.assert.calledOnce(branchStub);
        sinon.assert.calledThrice(execStub);
    });

    test('Error in tooltip when `sync` failed', async () => {
        const execStub = getExecStub(this.ctx.sandbox);
        const syncStub = execStub
            .withArgs(['sync'])
            .resolves(
                fakeExecutionResult({ stderr: 'test failure', exitCode: 1 })
            );
        const changeStub = fakeFossilChanges(
            execStub,
            'None. Already up-to-date'
        );
        await commands.executeCommand('fossil.sync');
        sinon.assert.calledOnce(syncStub);
        sinon.assert.notCalled(changeStub); // sync failed, nothing changed
        sinon.assert.calledOnce(execStub);
        const syncBar = statusBarCommands()[1];
        assert.ok(syncBar.tooltip);
        assert.match(
            syncBar.tooltip,
            /^Next sync \d\d:\d\d:\d\d\nSync error: test failure\nNone\. Already up-to-date\nUpdate$/
        );
    });

    test('Local repository syncing', async () => {
        const rawExecStub = getRawExecStub(this.ctx.sandbox);
        const syncStub = rawExecStub.withArgs(['sync']).resolves(
            fakeRawExecutionResult({
                stderr: 'Usage: fossil sync URL\n',
                exitCode: 1,
            })
        );
        const sem = this.ctx.sandbox
            .stub(window, 'showErrorMessage')
            .resolves();
        const execStub = getExecStub(this.ctx.sandbox);
        const changeStub = fakeFossilChanges(
            execStub,
            'None. Already up-to-date'
        );

        await commands.executeCommand('fossil.sync');
        sinon.assert.notCalled(changeStub);
        sinon.assert.calledOnce(sem);
        sinon.assert.calledOnce(syncStub);
        const syncBar = statusBarCommands()[1];
        assert.ok(syncBar.tooltip);
        assert.match(
            syncBar.tooltip,
            /^Next sync \d\d:\d\d:\d\d\nrepository with no remote\nNone\. Already up-to-date\nUpdate$/
        );
    });

    test('Nonsensical "change" is ignored', async () => {
        const execStub = getExecStub(this.ctx.sandbox);
        const syncCall = execStub
            .withArgs(['sync'])
            .resolves(fakeExecutionResult());
        const changesCall = execStub
            .withArgs(['update', '--dry-run'])
            .resolves(fakeExecutionResult({ stdout: 'bad changes' }));
        await commands.executeCommand('fossil.sync');
        sinon.assert.calledOnceWithExactly(syncCall, ['sync']);
        sinon.assert.calledOnceWithExactly(
            changesCall,
            ['update', '--dry-run'],
            'Triggered by previous operation' as Reason,
            { logErrors: false }
        );
        const syncBar = statusBarCommands()[1];
        assert.equal(syncBar.title, '$(sync)');
        assert.ok(syncBar.tooltip);
        assert.match(
            syncBar.tooltip,
            /^Next sync \d\d:\d\d:\d\d\nunknown changes\nUpdate$/
        );

        // restore changes
        changesCall.resolves(fakeUpdateResult());
        await commands.executeCommand('fossil.sync');
        assert.match(
            statusBarCommands()[1].tooltip!,
            /^Next sync \d\d:\d\d:\d\d\nNone. Already up-to-date\nUpdate$/
        );
    });

    const changeAutoSyncIntervalSeconds = (seconds: number) => {
        const configStub = stubFossilConfig(this.ctx.sandbox);
        const getIntervalStub = configStub.get
            .withArgs('autoSyncInterval')
            .returns(seconds);
        const model = getModel();
        model['onDidChangeConfiguration']({
            affectsConfiguration: (key: string) =>
                ['fossil.autoSyncInterval', 'fossil'].includes(key),
        });
        sinon.assert.calledOnce(getIntervalStub);
    };

    test('Can change `fossil.autoSyncInterval` to 5 minutes', async () => {
        changeAutoSyncIntervalSeconds(5 * 60);
        const nextSyncString = new Date(N.getTime() + 5 * 60 * 1000)
            .toTimeString()
            .split(' ')[0];
        const syncBar = statusBarCommands()[1];
        assert.equal(syncBar.title, '$(sync)');
        assert.equal(
            syncBar.tooltip,
            `Next sync ${nextSyncString}\nNone. Already up-to-date\nUpdate`
        );
    });

    test('Can change `fossil.autoSyncInterval` to 0 minutes (disable)', async () => {
        changeAutoSyncIntervalSeconds(0);
        const syncBar = statusBarCommands()[1];
        assert.equal(syncBar.title, '$(sync)');
        assert.equal(
            syncBar.tooltip,
            `Auto sync disabled\nNone. Already up-to-date\nUpdate`
        );
    });

    test('Periodic syncing calls `Repository.periodicSync`', async () => {
        const timeoutStub = sinon
            .stub(global, 'setTimeout')
            .callThrough()
            .withArgs(sinon.match.func, 3 * 60 * 1000);
        changeAutoSyncIntervalSeconds(3 * 60);
        sinon.assert.calledOnce(timeoutStub);

        const execStub = getExecStub(this.ctx.sandbox);
        const changesStub = fakeFossilChanges(execStub);
        const syncCall = execStub
            .withArgs(['sync'])
            .resolves(fakeExecutionResult());
        // calling `Repository.periodicSync`
        await (timeoutStub.firstCall.args[0] as () => () => Promise<void>)();
        sinon.assert.calledOnce(changesStub);
        sinon.assert.calledOnce(syncCall);
        sinon.assert.calledTwice(execStub);
    });
}
