import { Uri, workspace, window, commands, ViewColumn } from 'vscode';
import * as sinon from 'sinon';
import { FossilCWD } from '../../fossilExecutable';
import {
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

async function documentWasShown(
    sandbox: sinon.SinonSandbox,
    urlMatch: string | sinon.SinonMatcher,
    showMatch: any[],
    body: () => Thenable<void>
) {
    const openTextDocument = sandbox.stub(
        workspace,
        'openTextDocument'
    ) as sinon.SinonStub;
    openTextDocument.resolves(42);

    const showTextDocument = (
        sandbox.stub(window, 'showTextDocument') as sinon.SinonStub
    ).resolves();

    await body();

    sinon.assert.calledOnceWithExactly(openTextDocument, urlMatch);
    sinon.assert.calledOnceWithExactly(showTextDocument, 42, ...showMatch);

    openTextDocument.restore();
    showTextDocument.restore();
}

export function resourceActionsSuite(this: Suite): void {
    test('fossil add nothing', async () => {
        await commands.executeCommand('fossil.add');
    });

    test('fossil add', async () => {
        const root = workspace.workspaceFolders![0].uri;
        const uri = Uri.joinPath(root, 'add.txt');
        await fs.writeFile(uri.fsPath, 'fossil_add');

        const repository = getRepository();
        await repository.updateModelState();
        const resource = repository.untrackedGroup.getResource(uri);
        assert.ok(resource);

        await commands.executeCommand('fossil.add', resource);
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
        await commands.executeCommand('fossil.addAll');
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
        await commands.executeCommand('fossil.addAll');
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
        await commands.executeCommand(
            'fossil.forget',
            ...repository.workingGroup.resourceStates
        );
        sinon.assert.calledOnceWithMatch(forgetCallStub, [
            'forget',
            'a.txt',
            'b.txt',
        ]);

        // better branch coverage
        await commands.executeCommand('fossil.forget');
        assert.equal(repository.untrackedGroup.resourceStates.length, 1);
        await commands.executeCommand(
            'fossil.forget',
            ...repository.untrackedGroup.resourceStates
        );
    }).timeout(5000);
    test('Ignore', async () => {
        const rootUri = workspace.workspaceFolders![0].uri;
        const uriToIgnore = Uri.joinPath(rootUri, 'autogenerated');
        const urlIgnoredGlob = Uri.joinPath(
            rootUri,
            '.fossil-settings',
            'ignore-glob'
        );
        await fs.writeFile(uriToIgnore.fsPath, `autogenerated\n`);

        const repository = getRepository();
        await repository.updateModelState();
        const resource = repository.untrackedGroup.getResource(uriToIgnore);
        assert.ok(resource);
        assert.ok(!existsSync(urlIgnoredGlob.fsPath));

        await documentWasShown(
            this.ctx.sandbox,
            urlIgnoredGlob.fsPath,
            [],
            () => commands.executeCommand('fossil.ignore', resource)
        );
        const globIgnore = await fs.readFile(urlIgnoredGlob.fsPath);
        assert.equal(globIgnore.toString('utf-8'), 'autogenerated\n');
        const cwd = workspace.workspaceFolders![0].uri.fsPath as FossilCWD;
        const executable = getExecutable();
        await executable.exec(cwd, ['commit', '-m', 'fossil_ignore_new']);

        // now append to ignore list
        const uriToIgnore2 = Uri.joinPath(rootUri, 'autogenerated2');
        await fs.writeFile(uriToIgnore2.fsPath, `autogenerated2\n`);
        await repository.updateModelState();
        const resource2 = repository.untrackedGroup.getResource(uriToIgnore2);
        assert.ok(resource2);
        await documentWasShown(
            this.ctx.sandbox,
            urlIgnoredGlob.fsPath,
            [],
            () => commands.executeCommand('fossil.ignore', resource2)
        );

        const globIgnore2 = await fs.readFile(urlIgnoredGlob.fsPath);
        assert.equal(
            globIgnore2.toString('utf-8'),
            'autogenerated\nautogenerated2\n'
        );
        await executable.exec(cwd, ['commit', '-m', 'fossil_ignore_new_2']);
    }).timeout(8000);

    test('Open files (nothing)', async () => {
        await commands.executeCommand('fossil.openFiles');
    });

    test('Open files', async () => {
        const rootUri = workspace.workspaceFolders![0].uri;
        const uriToOpen = Uri.joinPath(rootUri, 'a file to open.txt');
        await fs.writeFile(uriToOpen.fsPath, `text inside\n`);

        const repository = getRepository();
        await repository.updateModelState();
        const resource = repository.untrackedGroup.getResource(uriToOpen);
        assert.ok(resource);

        await documentWasShown(
            this.ctx.sandbox,
            sinon.match({ path: uriToOpen.path }),
            [
                {
                    preserveFocus: true,
                    preview: true,
                    viewColumn: ViewColumn.Active,
                },
            ],
            () => commands.executeCommand('fossil.openFiles', resource)
        );
    }).timeout(6000);

    test('Open resource: nothing', async () => {
        await commands.executeCommand('fossil.openResource');
    }).timeout(100);

    const diffCheck = async (status: string, caption: string) => {
        const repository = getRepository();
        const root = workspace.workspaceFolders![0].uri;
        const uri = Uri.joinPath(root, 'open_resource.txt');
        const execStub = getExecStub(this.ctx.sandbox);
        const statusStub = fakeFossilStatus(
            execStub,
            `${status} open_resource.txt`
        );
        await repository.updateModelState();
        sinon.assert.calledOnce(statusStub);
        const resource = repository.workingGroup.getResource(uri);
        assert.ok(resource);

        const diffCall = this.ctx.sandbox
            .stub(commands, 'executeCommand')
            .callThrough()
            .withArgs('vscode.diff')
            .resolves();

        await commands.executeCommand('fossil.openResource', resource);

        sinon.assert.calledOnceWithExactly(
            diffCall,
            'vscode.diff',
            sinon.match({ path: uri.fsPath }),
            sinon.match({ path: uri.fsPath }),
            `open_resource.txt (${caption})`,
            {
                preserveFocus: true,
                preview: undefined,
                viewColumn: -1,
            }
        );
    };

    test('Open resource (Working Directory)', async () => {
        await diffCheck('EDITED', 'Working Directory');
    });

    test('Open resource (Deleted)', async () => {
        await diffCheck('DELETED', 'Deleted');
    });

    test('Open resource (Missing)', async () => {
        await diffCheck('MISSING', 'Missing');
    });

    test('Open resource (Renamed)', async () => {
        await diffCheck('RENAMED', 'Renamed');
    });
}
