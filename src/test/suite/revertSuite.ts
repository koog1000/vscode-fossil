import { Uri, window, workspace, commands } from 'vscode';
import * as sinon from 'sinon';
import { add, fakeFossilStatus, getExecStub, getRepository } from './common';
import * as assert from 'assert/strict';
import * as fs from 'fs/promises';
import type { Suite } from 'mocha';
import type { FossilResourceGroup } from '../../resourceGroups';
import type { FossilResource } from '../../repository';
import { Reason } from '../../fossilExecutable';
import { RelativePath } from '../../openedRepository';

export function RevertSuite(this: Suite): void {
    test('Single source', async () => {
        const url = await add(
            'revert_me.txt',
            'Some original text\n',
            'add revert_me.txt'
        );
        await fs.writeFile(url.fsPath, 'something new');

        const repository = getRepository();
        await repository.updateStatus('Test' as Reason);
        const resource = repository.workingGroup.getResource(url);
        assert.ok(resource);

        const showWarningMessage: sinon.SinonStub = this.ctx.sandbox.stub(
            window,
            'showWarningMessage'
        );
        showWarningMessage.onFirstCall().resolves('&&Discard Changes');

        await commands.executeCommand('fossil.revert', resource);
        const newContext = await fs.readFile(url.fsPath);
        assert.equal(newContext.toString('utf-8'), 'Some original text\n');
    });

    suite('Dialog has no typos', () => {
        let swmResources: FossilResource[];
        const prepareResources = async () => {
            if (swmResources) {
                return swmResources;
            }
            const repository = getRepository();
            const rootUri = workspace.workspaceFolders![0].uri;
            const fake_status = [];
            const execStub = getExecStub(this.ctx.sandbox);
            const fileUris: Uri[] = [];
            for (const filename of 'abcdefghijklmn') {
                // 14 files
                const fileUri = Uri.joinPath(rootUri, 'added', filename);
                const action = ['k', 'l', 'm', 'n'].includes(filename)
                    ? 'ADDED'
                    : 'EDITED';
                fake_status.push(`${action}     added/${filename}`);
                fileUris.push(fileUri);
            }
            const statusCall = fakeFossilStatus(
                execStub,
                fake_status.join('\n')
            );
            await repository.updateStatus('Test' as Reason);
            sinon.assert.calledOnce(statusCall);
            const resources = fileUris.map(uri => {
                const resource = repository.workingGroup.getResource(uri);
                assert.ok(resource);
                return resource;
            });
            swmResources = resources;
            return swmResources;
        };

        test('10 + 4 files', async () => {
            const resources = await prepareResources();
            const swm = this.ctx.sandbox.stub(window, 'showWarningMessage');
            await commands.executeCommand('fossil.revert', ...resources);
            sinon.assert.calledOnceWithMatch(
                swm,
                'Are you sure you want to discard changes to 10 files?\n' +
                    '\n • a\n • b\n • c\n • d\n • e\n • f\n • g\n • h\n' +
                    'and 2 others\n\n(and forget 4 other added files)',
                { modal: true }
            );
        });

        test('10  files', async () => {
            const resources = await prepareResources();
            const swm = this.ctx.sandbox.stub(window, 'showWarningMessage');
            await commands.executeCommand(
                'fossil.revert',
                ...resources.slice(0, 10)
            );
            sinon.assert.calledOnceWithMatch(
                swm,
                'Are you sure you want to discard changes to 10 files?\n' +
                    '\n • a\n • b\n • c\n • d\n • e\n • f\n • g\n • h\n' +
                    'and 2 others',
                { modal: true }
            );
        });

        test('3 files', async () => {
            const resources = await prepareResources();
            const swm = this.ctx.sandbox.stub(window, 'showWarningMessage');
            await commands.executeCommand(
                'fossil.revert',
                ...resources.slice(0, 3)
            );
            sinon.assert.calledOnceWithMatch(
                swm,
                'Are you sure you want to discard changes to 3 files?\n' +
                    '\n • a\n • b\n • c',
                { modal: true }
            );
        });

        test('2 added file', async () => {
            const resources = await prepareResources();
            const swm = this.ctx.sandbox.stub(window, 'showWarningMessage');
            await commands.executeCommand(
                'fossil.revert',
                ...resources.slice(10, 12)
            );
            sinon.assert.notCalled(swm);
        });
    });

    test('Revert (Nothing)', async () => {
        await commands.executeCommand('fossil.revert');
    });

    // for testing `fossil.revertAll` only
    async function revertAllTest(
        sandbox: sinon.SinonSandbox,
        groups: FossilResourceGroup[],
        message: string,
        files: string[]
    ): Promise<void> {
        const swm: sinon.SinonStub = sandbox.stub(window, 'showWarningMessage');
        swm.onFirstCall().resolves('&&Discard Changes');

        const repository = getRepository();
        const execStub = getExecStub(sandbox);
        const statusStub = fakeFossilStatus(
            execStub,
            'EDITED a.txt\nEDITED b.txt\nCONFLICT c.txt\nCONFLICT d.txt'
        );
        const revertStub = execStub
            .withArgs(sinon.match.array.startsWith(['revert']))
            .resolves();
        await repository.updateStatus('Test' as Reason);
        sinon.assert.calledOnce(statusStub);
        await commands.executeCommand('fossil.revertAll', ...groups);
        sinon.assert.calledOnceWithExactly(
            swm,
            message,
            { modal: true },
            '&&Discard Changes'
        );
        sinon.assert.calledOnceWithExactly(revertStub, [
            'revert',
            ...(files as RelativePath[]),
        ]);
    }

    test('Revert all (no groups)', async () => {
        await revertAllTest(
            this.ctx.sandbox,
            [],
            'Are you sure you want to discard changes in ' +
                '"Changes" and "Unresolved Conflicts" group?',
            ['a.txt', 'b.txt', 'c.txt', 'd.txt']
        );
    });

    test('Revert all (changes group)', async () => {
        const repository = getRepository();
        await revertAllTest(
            this.ctx.sandbox,
            [repository.workingGroup],
            'Are you sure you want to discard changes in "Changes" group?',
            ['a.txt', 'b.txt']
        );
    });

    test('Revert all (conflict group)', async () => {
        const repository = getRepository();
        await revertAllTest(
            this.ctx.sandbox,
            [repository.conflictGroup],
            'Are you sure you want to discard changes ' +
                'in "Unresolved Conflicts" group?',
            ['c.txt', 'd.txt']
        );
    });
}
