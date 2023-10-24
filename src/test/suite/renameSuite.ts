import * as vscode from 'vscode';
import { Uri, window, workspace, commands } from 'vscode';
import * as sinon from 'sinon';
import {
    add,
    assertGroups,
    cleanupFossil,
    fakeFossilStatus,
    getExecStub,
    getRepository,
} from './common';
import * as assert from 'assert/strict';
import * as fs from 'fs/promises';
import { OpenedRepository, ResourceStatus } from '../../openedRepository';
import { delay, eventToPromise } from '../../util';
import { Suite, before } from 'mocha';

export function RenameSuite(this: Suite): void {
    before(async () => {
        const repository = getRepository();
        await cleanupFossil(repository);
    });

    test('Rename a file', async () => {
        const oldFilename = 'not_renamed.txt';
        const newFilename = 'renamed.txt';
        const rootUri = workspace.workspaceFolders![0].uri;
        await add(oldFilename, 'foo content\n', `add: ${oldFilename}`, 'ADDED');

        const sim: sinon.SinonStub = this.ctx.sandbox.stub(
            window,
            'showInformationMessage'
        );
        const answeredYes = sim.onFirstCall().resolves('Yes');

        const edit = new vscode.WorkspaceEdit();
        const newFilePath = Uri.joinPath(rootUri, newFilename);
        edit.renameFile(Uri.joinPath(rootUri, oldFilename), newFilePath);

        const success = await workspace.applyEdit(edit);
        assert.ok(success);

        const repository = getRepository();
        await answeredYes;
        await eventToPromise(repository.onDidRunOperation);
        await repository.updateModelState();

        assertGroups(
            repository,
            new Map([[newFilePath.fsPath, ResourceStatus.RENAMED]]),
            new Map()
        );
    }).timeout(6000);

    test("Don't show again", async () => {
        const config = () => workspace.getConfiguration('fossil');
        assert.equal(config().get('enableRenaming'), true, 'contract');
        const rootUri = workspace.workspaceFolders![0].uri;
        const execStub = getExecStub(this.ctx.sandbox);
        const oldFilename = 'do_not_show.txt';
        await fs.writeFile(Uri.joinPath(rootUri, oldFilename).fsPath, '123');
        const newFilename = 'test_failed.txt';

        const edit = new vscode.WorkspaceEdit();
        const newFilePath = Uri.joinPath(rootUri, newFilename);
        edit.renameFile(Uri.joinPath(rootUri, oldFilename), newFilePath);

        const sim = (
            this.ctx.sandbox.stub(
                window,
                'showInformationMessage'
            ) as sinon.SinonStub
        ).resolves("Don't show again");

        const status = await fakeFossilStatus(
            execStub,
            `EDITED ${oldFilename}\n`
        );
        const success = await workspace.applyEdit(edit);
        assert.ok(success);
        sinon.assert.calledOnceWithExactly(
            status,
            ['status', '--differ', '--merge'],
            'file rename event'
        );
        sinon.assert.calledOnceWithExactly(
            sim,
            '"do_not_show.txt" was renamed to "test_failed.txt" on ' +
                'filesystem. Rename in fossil repository too?',
            {
                modal: false,
            },
            'Yes',
            'Cancel',
            "Don't show again"
        );

        for (let i = 1; i < 100; ++i) {
            if (config().get('enableRenaming') === false) {
                break;
            }
            await delay(i * 11);
        }
        assert.equal(config().get('enableRenaming'), false, 'no update');
        await config().update('enableRenaming', true);
    }).timeout(3000);

    test('Rename directory', async () => {
        const oldDirname = 'not_renamed';
        const newDirname = 'renamed';
        const rootUri = workspace.workspaceFolders![0].uri;
        const oldDirUrl = Uri.joinPath(rootUri, oldDirname);
        const newDirUrl = Uri.joinPath(rootUri, newDirname);
        await fs.mkdir(oldDirUrl.fsPath);
        const filenames = ['mud', 'cabbage', 'brick'];
        const oldUris = filenames.map(filename =>
            Uri.joinPath(oldDirUrl, filename)
        );
        const newUris = filenames.map(filename =>
            Uri.joinPath(newDirUrl, filename)
        );

        await Promise.all(
            oldUris.map(uri => fs.writeFile(uri.fsPath, `foo ${uri}\n`))
        );
        const repository = getRepository();
        const openedRepository: OpenedRepository = (repository as any)
            .repository;
        await openedRepository.exec(['add', oldDirname]);
        await openedRepository.exec([
            'commit',
            '-m',
            `add directory: ${oldDirname}`,
            '--no-warnings',
        ]);

        const sim: sinon.SinonStub = this.ctx.sandbox.stub(
            window,
            'showInformationMessage'
        );

        const answeredYes = sim.onFirstCall().resolves('Yes');

        const edit = new vscode.WorkspaceEdit();
        edit.renameFile(oldDirUrl, newDirUrl);

        const success = await workspace.applyEdit(edit);
        assert.ok(success);

        await answeredYes;
        await eventToPromise(repository.onDidRunOperation);
        await repository.updateModelState();

        const ref: [string, ResourceStatus][] = newUris.map((url: Uri) => [
            url.fsPath,
            ResourceStatus.RENAMED,
        ]);
        assertGroups(repository, new Map(ref), new Map());
    }).timeout(10000);

    test('Relocate', async () => {
        const repository = getRepository();
        await cleanupFossil(repository);
        const oldFilename = 'not_relocated.txt';
        const newFilename = 'relocated.txt';
        const rootUri = workspace.workspaceFolders![0].uri;
        const newUri = Uri.joinPath(rootUri, newFilename);
        const oldUri = await add(
            oldFilename,
            'foo content\n',
            `add: ${oldFilename}`,
            'ADDED'
        );
        await fs.rename(oldUri.fsPath, newUri.fsPath);
        await repository.updateModelState();
        assertGroups(
            repository,
            new Map([[oldUri.fsPath, ResourceStatus.MISSING]]),
            new Map()
        );
        this.ctx.sandbox
            .stub(window, 'showQuickPick')
            .onFirstCall()
            .callsFake(items => {
                assert.ok(items instanceof Array);
                return Promise.resolve(items[0]);
            });

        const sod = this.ctx.sandbox
            .stub(window, 'showOpenDialog')
            .resolves([newUri]);
        await commands.executeCommand(
            'fossil.relocate',
            repository.workingGroup.resourceStates[0]
        );
        sinon.assert.calledOnce(sod);
        assertGroups(
            repository,
            new Map([[newUri.fsPath, ResourceStatus.RENAMED]]),
            new Map()
        );
    }).timeout(10000);

    test('Relocate nothing', async () => {
        await commands.executeCommand('fossil.relocate');
    });
}
