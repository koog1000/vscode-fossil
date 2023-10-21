import { Uri, window, workspace, commands } from 'vscode';
import * as sinon from 'sinon';
import {
    assertGroups,
    cleanupFossil,
    fakeExecutionResult,
    fakeFossilStatus,
    fakeRawExecutionResult,
    getExecStub,
    getRawExecStub,
    getRepository,
} from './common';
import * as assert from 'assert/strict';
import * as fs from 'fs/promises';
import { FossilBranch, OpenedRepository } from '../../openedRepository';
import { Suite } from 'mocha';

export function MergeSuite(this: Suite): void {
    test('Merge error is shown', async () => {
        const mergeExec = getRawExecStub(this.ctx.sandbox)
            .withArgs(sinon.match.array.startsWith(['merge']))
            .resolves(
                fakeRawExecutionResult({
                    stderr:
                        'cannot find a common ancestor between ' +
                        'the current check-out and trunk',
                    exitCode: 1,
                })
            );
        const sqp = this.ctx.sandbox
            .stub(window, 'showQuickPick')
            .onFirstCall()
            .callsFake(items => {
                assert.ok(items instanceof Array);
                assert.equal(items[0].label, '$(git-branch) trunk');
                return Promise.resolve(items[0]);
            });
        const swm: sinon.SinonStub = this.ctx.sandbox
            .stub(window, 'showWarningMessage')
            .onFirstCall()
            .resolves();

        const sem: sinon.SinonStub = this.ctx.sandbox
            .stub(window, 'showErrorMessage')
            .onFirstCall()
            .resolves();
        const sib = this.ctx.sandbox
            .stub(window, 'showInputBox')
            .resolves('trunk merge message');

        await commands.executeCommand('fossil.merge');
        sinon.assert.calledOnceWithExactly(mergeExec, ['merge', 'trunk'], {
            cwd: sinon.match.string,
        });
        sinon.assert.calledOnce(sqp);
        sinon.assert.notCalled(sib);
        sinon.assert.notCalled(swm);
        sinon.assert.calledOnceWithExactly(
            sem,
            'Fossil: cannot find a common ancestor between ' +
                'the current check-out and trunk',
            'Open Fossil Log'
        );
    });

    test('Merge', async () => {
        const repository = getRepository();
        const openedRepository: OpenedRepository = (repository as any)
            .repository;

        const fooFilename = 'foo-merge.txt';
        const barFilename = 'bar-merge.txt';
        const rootUri = workspace.workspaceFolders![0].uri;
        const fooPath = Uri.joinPath(rootUri, fooFilename).fsPath;
        await fs.writeFile(fooPath, 'foo content\n');
        await openedRepository.exec(['add', fooFilename]);
        await openedRepository.exec([
            'commit',
            '-m',
            `add: ${fooFilename}`,
            '--no-warnings',
        ]);
        const barPath = Uri.joinPath(rootUri, fooFilename).fsPath;
        await fs.writeFile(barPath, 'bar content\n');
        await openedRepository.exec(['add', barFilename]);
        await fs.appendFile(fooPath, 'foo content 2\n');
        await openedRepository.exec([
            'commit',
            '-m',
            `add: ${barFilename}; mod`,
            '--no-warnings',
            '--branch',
            'fossil-merge',
        ]);
        await openedRepository.exec(['update', 'trunk']);

        await commands.executeCommand('fossil.refresh');
        await repository.updateModelState();
        assertGroups(repository, new Map(), new Map());

        const sqp: sinon.SinonStub = this.ctx.sandbox.stub(
            window,
            'showQuickPick'
        );
        sqp.resolves({
            checkin: 'fossil-merge' as FossilBranch,
        });
        const sib = this.ctx.sandbox.stub(window, 'showInputBox');
        sib.resolves('test merge message');

        await commands.executeCommand('fossil.merge');
        sinon.assert.calledOnce(sqp);
        sinon.assert.calledOnce(sib);

        await repository.updateModelState('test');
        assertGroups(repository, new Map(), new Map());
    }).timeout(5000);

    test('Cancel merge when a merge is in progress', async () => {
        const execStub = getExecStub(this.ctx.sandbox);
        execStub
            .withArgs(['branch', 'ls', '-t'])
            .resolves(fakeExecutionResult({ stdout: ' * a\n   b\n   c\n' }));
        fakeFossilStatus(execStub, 'INTEGRATE 0123456789');
        await getRepository().updateModelState();
        const sqp = this.ctx.sandbox.stub(window, 'showQuickPick');
        const swm: sinon.SinonStub = this.ctx.sandbox
            .stub(window, 'showWarningMessage')
            .onFirstCall()
            .resolves();

        await commands.executeCommand('fossil.merge');
        sinon.assert.notCalled(sqp);
        sinon.assert.calledOnceWithExactly(
            swm,
            'Merge is in progress',
            { modal: true },
            'Continue'
        );
    });

    test('Integrate', async () => {
        const repository = getRepository();
        await cleanupFossil(repository);
        const execStub = getExecStub(this.ctx.sandbox);
        execStub
            .withArgs(['branch', 'ls', '-t'])
            .resolves(fakeExecutionResult({ stdout: ' * a\n   b\n   c\n' }));
        fakeFossilStatus(execStub, 'INTEGRATE 0123456789');
        await repository.updateModelState();
        const mergeStub = execStub
            .withArgs(['merge', 'c', '--integrate'])
            .resolves(fakeExecutionResult());
        const commitStub = execStub
            .withArgs(sinon.match.array.startsWith(['commit']))
            .resolves(fakeExecutionResult());
        this.ctx.sandbox
            .stub(window, 'showQuickPick')
            .onFirstCall()
            .callsFake(items => {
                assert.ok(items instanceof Array);
                assert.equal(items[2].label, '$(git-branch) c');
                return Promise.resolve(items[2]);
            });
        const sim = this.ctx.sandbox.stub(window, 'showInformationMessage');
        const swm = this.ctx.sandbox
            .stub(window, 'showWarningMessage')
            .onFirstCall()
            .resolves('Continue' as any);
        const sib = this.ctx.sandbox
            .stub(window, 'showInputBox')
            .withArgs(sinon.match({ placeHolder: 'Commit message' }))
            .callsFake(options => Promise.resolve(options!.value));

        await commands.executeCommand('fossil.integrate');
        sinon.assert.notCalled(sim);
        sinon.assert.calledOnceWithExactly(
            swm,
            'Merge is in progress',
            { modal: true },
            'Continue' as any
        );
        sinon.assert.calledOnceWithExactly(sib, {
            value: 'Merge c into trunk',
            placeHolder: 'Commit message',
            prompt: 'Please provide a commit message',
            ignoreFocusOut: true,
        });
        sinon.assert.calledOnce(mergeStub);
        sinon.assert.calledOnceWithExactly(commitStub, [
            'commit',
            '-m',
            'Merge c into trunk',
        ]);
    }).timeout(5000);

    test('Cherrypick', async () => {
        const execStub = getExecStub(this.ctx.sandbox);
        execStub
            .withArgs(['branch', 'ls', '-t'])
            .resolves(fakeExecutionResult({ stdout: ' * a\n   b\n   c\n' }));
        fakeFossilStatus(execStub, '');
        const repository = getRepository();
        await repository.updateModelState();
        let hash = '';
        const mergeCallStub = execStub
            .withArgs(sinon.match.array.startsWith(['merge']))
            .resolves(fakeExecutionResult());

        this.ctx.sandbox
            .stub(window, 'showQuickPick')
            .onFirstCall()
            .callsFake(items => {
                assert.ok(items instanceof Array);
                assert.ok(typeof items[0].description == 'string');
                assert.match(
                    items[0].description,
                    /\$\(person\)\w+ \$\(calendar\) now$/
                );
                assert.equal(items[0].detail, 'test merge message');
                assert.match(
                    items[0].label,
                    /\$\(circle-outline\) [0-9a-f]{12} • trunk$/
                );
                hash = (items[0] as unknown as { commit: { hash: string } })
                    .commit.hash;
                assert.ok(hash);
                return Promise.resolve(items[0]);
            });
        const sim = this.ctx.sandbox
            .stub(window, 'showInformationMessage')
            .withArgs('There are no changes to commit.')
            .resolves();

        await commands.executeCommand('fossil.cherrypick');
        sinon.assert.calledOnceWithMatch(mergeCallStub, [
            'merge',
            hash,
            '--cherrypick',
        ]);
        sinon.assert.calledOnce(sim);
    });
}
