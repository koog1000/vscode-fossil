import * as vscode from 'vscode';
import { Uri, workspace } from 'vscode';
import * as sinon from 'sinon';
import { FossilCWD } from '../../fossilExecutable';
import {
    add,
    assertGroups,
    cleanupFossil,
    fakeFossilStatus,
    getExecStub,
    getExecutable,
    getRepository,
} from './common';
import * as assert from 'assert/strict';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import { Suite } from 'mocha';
import { ResourceStatus } from '../../openedRepository';

async function document_was_shown(
    sandbox: sinon.SinonSandbox,
    urlMatch: any,
    showMatch: any[],
    body: () => Thenable<void>
) {
    const openTextDocument = sandbox.stub(
        workspace,
        'openTextDocument'
    ) as sinon.SinonStub;
    openTextDocument.resolves(42);

    const showTextDocument = sandbox.stub(
        vscode.window,
        'showTextDocument'
    ) as sinon.SinonStub;
    showTextDocument.resolves(undefined);

    await body();

    assert.ok(openTextDocument.calledOnceWith(urlMatch));
    assert.ok(showTextDocument.calledOnceWith(42, ...showMatch));

    openTextDocument.restore();
    showTextDocument.restore();
}

export function resourceActionsSuite(this: Suite): void {
    test('fossil add nothing', async () => {
        await vscode.commands.executeCommand('fossil.add');
    });

    test('fossil add', async () => {
        const root = workspace.workspaceFolders![0].uri;
        const uri = Uri.joinPath(root, 'add.txt');
        await fs.writeFile(uri.fsPath, 'fossil_add');

        const repository = getRepository();
        await repository.updateModelState();
        const resource = repository.untrackedGroup.getResource(uri);
        assert.ok(resource);

        await vscode.commands.executeCommand('fossil.add', resource);
        await repository.updateModelState();
        assert(!repository.untrackedGroup.includesUri(uri));
        assert(repository.stagingGroup.includesUri(uri));
    }).timeout(5000);

    test('fossil add untracked', async () => {
        let execStub = getExecStub(this.ctx.sandbox);
        let statusStub = fakeFossilStatus(execStub, 'EXTRA a.txt\nEXTRA b.txt');

        const repository = getRepository();
        await repository.updateModelState('test');
        sinon.assert.calledOnce(statusStub);
        assert.equal(repository.untrackedGroup.resourceStates.length, 2);
        assertGroups(repository, new Map(), new Map());
        execStub.restore();
        execStub = getExecStub(this.ctx.sandbox);
        statusStub = fakeFossilStatus(execStub, 'ADDED a.txt\nADDED b.txt');
        const addStub = execStub
            .withArgs(sinon.match.array.startsWith(['add']))
            .resolves();
        await vscode.commands.executeCommand('fossil.addAll');
        sinon.assert.calledOnce(statusStub);
        sinon.assert.calledOnceWithExactly(addStub, ['add', 'a.txt', 'b.txt']);
        const root = workspace.workspaceFolders![0].uri;
        assertGroups(
            repository,
            new Map(),
            new Map([
                [Uri.joinPath(root, 'a.txt').fsPath, ResourceStatus.ADDED],
                [Uri.joinPath(root, 'b.txt').fsPath, ResourceStatus.ADDED],
            ])
        );
    });

    test('fossil add untracked does not add working group', async () => {
        const repository = getRepository();
        await cleanupFossil(repository);
        const execStub = getExecStub(this.ctx.sandbox);
        const statusStub = fakeFossilStatus(execStub, 'ADDED a\nADDED b');
        await repository.updateModelState('test');
        sinon.assert.calledOnce(statusStub);
        assert.equal(repository.workingGroup.resourceStates.length, 2);
        assert.equal(repository.stagingGroup.resourceStates.length, 0);
        await vscode.commands.executeCommand('fossil.addAll');
        sinon.assert.calledOnce(statusStub);
        assert.equal(repository.workingGroup.resourceStates.length, 2);
        assert.equal(repository.stagingGroup.resourceStates.length, 0);
    });

    test('fossil forget', async () => {
        const repository = getRepository();
        const execStub = getExecStub(this.ctx.sandbox);
        const forgetCallStub = execStub
            .withArgs(sinon.match.array.startsWith(['forget']))
            .resolves();
        await fakeFossilStatus(
            execStub,
            'ADDED a.txt\nEDITED b.txt\nEXTRA c.txt'
        );
        await repository.updateModelState();
        await vscode.commands.executeCommand(
            'fossil.forget',
            ...repository.workingGroup.resourceStates
        );
        sinon.assert.calledOnceWithMatch(forgetCallStub, [
            'forget',
            'a.txt',
            'b.txt',
        ]);

        // better branch coverage
        await vscode.commands.executeCommand('fossil.forget');
        assert.equal(repository.untrackedGroup.resourceStates.length, 1);
        await vscode.commands.executeCommand(
            'fossil.forget',
            ...repository.untrackedGroup.resourceStates
        );
    }).timeout(5000);
    test('fossil ignore', async () => {
        const rootUri = workspace.workspaceFolders![0].uri;
        const uriToIgnore = Uri.joinPath(rootUri, 'autogenerated');
        const urlIgnoredGlob = Uri.joinPath(
            rootUri,
            '.fossil-settings',
            'ignore-glob'
        );
        fs.writeFile(uriToIgnore.fsPath, `autogenerated\n`);

        const repository = getRepository();
        await repository.updateModelState();
        const resource = repository.untrackedGroup.getResource(uriToIgnore);
        assert.ok(resource);
        assert.ok(!existsSync(urlIgnoredGlob.fsPath));

        await document_was_shown(
            this.ctx.sandbox,
            urlIgnoredGlob.fsPath,
            [],
            () => vscode.commands.executeCommand('fossil.ignore', resource)
        );
        const globIgnore = await fs.readFile(urlIgnoredGlob.fsPath);
        assert.equal(globIgnore.toString('utf-8'), 'autogenerated\n');
        const cwd = workspace.workspaceFolders![0].uri.fsPath as FossilCWD;
        const executable = getExecutable();
        await executable.exec(cwd, ['commit', '-m', 'fossil_ignore_new']);

        // now append to ignore list
        const uriToIgnore2 = Uri.joinPath(rootUri, 'autogenerated2');
        fs.writeFile(uriToIgnore2.fsPath, `autogenerated2\n`);
        await repository.updateModelState();
        const resource2 = repository.untrackedGroup.getResource(uriToIgnore2);
        assert.ok(resource2);
        await document_was_shown(
            this.ctx.sandbox,
            urlIgnoredGlob.fsPath,
            [],
            () => vscode.commands.executeCommand('fossil.ignore', resource2)
        );

        const globIgnore2 = await fs.readFile(urlIgnoredGlob.fsPath);
        assert.equal(
            globIgnore2.toString('utf-8'),
            'autogenerated\nautogenerated2\n'
        );
        await executable.exec(cwd, ['commit', '-m', 'fossil_ignore_new_2']);
    }).timeout(8000);

    test('fossil open files', async () => {
        await vscode.commands.executeCommand('fossil.openFiles'); // coverage

        const rootUri = workspace.workspaceFolders![0].uri;
        const uriToOpen = Uri.joinPath(rootUri, 'a file to open.txt');
        fs.writeFile(uriToOpen.fsPath, `text inside\n`);

        const repository = getRepository();
        await repository.updateModelState();
        const resource = repository.untrackedGroup.getResource(uriToOpen);
        assert.ok(resource);

        await document_was_shown(
            this.ctx.sandbox,
            sinon.match({ path: uriToOpen.path }),
            [
                {
                    preserveFocus: true,
                    preview: true,
                    viewColumn: vscode.ViewColumn.Active,
                },
            ],
            () => vscode.commands.executeCommand('fossil.openFiles', resource)
        );
    }).timeout(6000);
    test('fossil open resource', async () => {
        const url = await add(
            'open_resource.txt',
            'Some original text\n',
            'add open_resource.txt'
        );
        await fs.writeFile(url.fsPath, 'something new');

        const repository = getRepository();
        await repository.updateModelState();
        const resource = repository.workingGroup.getResource(url);
        assert.ok(resource);

        const execStub = this.ctx.sandbox.stub(
            vscode.commands,
            'executeCommand'
        );
        const diffCall = execStub.withArgs('vscode.diff');
        execStub.callThrough();

        await vscode.commands.executeCommand('fossil.openResource', resource);

        assert.ok(diffCall.calledOnce);

        await vscode.commands.executeCommand('fossil.openResource');
    }).timeout(12000);
}
