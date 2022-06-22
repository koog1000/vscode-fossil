import * as assert from 'assert/strict';
import { after, before, afterEach, beforeEach } from 'mocha';
import { window, Uri } from 'vscode';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as fs from 'fs';
import { Fossil, FossilCWD } from '../../fossilBase';
import { findFossil } from '../../main';
import { Model } from '../../model';
import { Repository, Status } from '../../repository';
import { eventToPromise } from '../../util';
import { FossilResourceGroup } from '../../resourceGroups';

async function createFossil(): Promise<Fossil> {
    const outputChannel = window.createOutputChannel('Fossil.Test');
    const info = await findFossil('', outputChannel);
    const fossil = new Fossil({
        fossilPath: info.path,
        version: info.version,
        enableInstrumentation: true,
        outputChannel: outputChannel,
    });
    return fossil;
}

async function fossilInit(sandbox: sinon.SinonSandbox) {
    assert.ok(vscode.workspace.workspaceFolders);
    const fossilPath = Uri.joinPath(
        vscode.workspace.workspaceFolders![0].uri,
        '/test.fossil'
    );
    assert.ok(
        !fs.existsSync(fossilPath.fsPath),
        `repo '${fossilPath.fsPath}' already exists`
    );

    const showSaveDialogstub = sandbox.stub(window, 'showSaveDialog');
    showSaveDialogstub.resolves(fossilPath);

    const showInformationMessage = sandbox.stub(
        window,
        'showInformationMessage'
    );
    showInformationMessage.resolves(undefined);

    await vscode.commands.executeCommand('fossil.init');
    assert.ok(showSaveDialogstub.calledOnce);
    assert.ok(
        fs.existsSync(fossilPath.fsPath),
        `Not a file: '${fossilPath.fsPath}'`
    );
    assert.ok(showInformationMessage.calledOnce);
}

async function fossilOpen(sandbox: sinon.SinonSandbox, fossil: Fossil) {
    assert.ok(vscode.workspace.workspaceFolders);
    const rootPath = vscode.workspace.workspaceFolders![0].uri;
    const fossilPath = Uri.joinPath(rootPath, '/test.fossil');
    assert.ok(
        fs.existsSync(fossilPath.fsPath),
        `repo '${fossilPath.fsPath}' must exist`
    );

    const showInformationMessage = sandbox.stub(window, 'showOpenDialog');
    showInformationMessage.onFirstCall().resolves([fossilPath]);
    showInformationMessage.onSecondCall().resolves([rootPath]);

    await vscode.commands.executeCommand('fossil.open');
    const res = await fossil.exec(rootPath.fsPath as FossilCWD, ['info']);
    assert.ok(/check-ins:\s+1\s*$/.test(res.stdout));
}

suite('Fossil', () => {
    const sandbox = sinon.createSandbox();
    let fossil: Fossil;
    before(async () => {
        fossil = await createFossil();
    });
    beforeEach(() => {
        if (!vscode.workspace.workspaceFolders) {
            throw new Error('Expected opened workspace. Probably setup issue.');
        }
        const roorPath = vscode.workspace.workspaceFolders[0].uri;
        vscode.window.showInformationMessage(`Ensure '${roorPath}' is empty`);
        const entities = fs.readdirSync(roorPath.fsPath);
        entities.forEach(name =>
            fs.unlinkSync(Uri.joinPath(roorPath, name).fsPath)
        );
    });

    afterEach(() => {
        sandbox.restore();
    });

    after(() => {
        window.showInformationMessage('All tests done!');
    });

    test('fossil.init', async () => {
        await fossilInit(sandbox);
    });

    test('fossil.open', async () => {
        await fossilInit(sandbox);
        await fossilOpen(sandbox, fossil);
    });

    test('fossil.close', async () => {
        await fossilInit(sandbox);
        await fossilOpen(sandbox, fossil);
        const cwd = vscode.workspace.workspaceFolders![0].uri
            .fsPath as FossilCWD;
        const res = await fossil.exec(cwd, ['info']);
        assert.ok(/check-ins:\s+1\s*$/.test(res.stdout));
        await vscode.commands.executeCommand('fossil.close');
        const res_promise = fossil.exec(cwd, ['status']);
        await assert.rejects(res_promise, (thrown: any) => {
            return /^current directory is not within an open checkout\s*$/.test(
                thrown.stderr
            );
        });
    });

    function assertGroups(
        repository: Repository,
        working: Map<string, Status>,
        staging: Map<string, Status>
    ) {
        const to_map = (grp: FossilResourceGroup) => {
            return new Map<string, Status>(
                grp.resourceStates.map(res => [
                    res.resourceUri.fsPath,
                    res.status,
                ])
            );
        };
        assert.deepStrictEqual(
            to_map(repository.workingDirectoryGroup),
            working
        );
        assert.deepStrictEqual(to_map(repository.stagingGroup), staging);
    }

    test('fossil rename is visible in Source Control panel', async () => {
        await fossilInit(sandbox);
        await fossilOpen(sandbox, fossil);
        const rootUri = vscode.workspace.workspaceFolders![0].uri;
        const cwd = rootUri.fsPath as FossilCWD;
        const fooPath = Uri.joinPath(rootUri, 'foo.txt').fsPath;
        await fs.promises.writeFile(fooPath, 'test\n');
        await fossil.exec(cwd, ['add', 'foo.txt']);
        const model = vscode.extensions.getExtension('koog1000.fossil')!
            .exports as Model;
        const repository = model.repositories[0];
        await eventToPromise(repository.onDidRunOperation);
        await repository.status();
        assertGroups(repository, new Map([[fooPath, Status.ADDED]]), new Map());

        await fossil.exec(cwd, [
            'commit',
            '-m',
            'add: foo.txt',
            '--no-warnings',
        ]);
        await repository.status();
        assertGroups(repository, new Map(), new Map());

        await fossil.exec(cwd, ['mv', 'foo.txt', 'bar.txt', '--hard']);
        await repository.status();
        const barPath = Uri.joinPath(rootUri, 'bar.txt').fsPath;
        assertGroups(
            repository,
            new Map([[barPath, Status.RENAMED]]),
            new Map()
        );
    });

    test('fossil integrate is visible in Source Control panel', async () => {
        await fossilInit(sandbox);
        await fossilOpen(sandbox, fossil);
        const rootUri = vscode.workspace.workspaceFolders![0].uri;
        const cwd = rootUri.fsPath as FossilCWD;
        const fooPath = Uri.joinPath(rootUri, 'foo.txt').fsPath;

        await fs.promises.writeFile(fooPath, 'test\n');
        await fossil.exec(cwd, ['add', 'foo.txt']);
        await fossil.exec(cwd, [
            'commit',
            '-m',
            'add: foo.txt',
            '--no-warnings',
        ]);
        const barPath = Uri.joinPath(rootUri, 'bar.txt').fsPath;
        await fs.promises.writeFile(barPath, 'test bar\n');
        await fs.promises.appendFile(fooPath, 'appended\n');
        await fossil.exec(cwd, ['add', 'bar.txt']);
        console.log;
        await fossil.exec(cwd, [
            'commit',
            '-m',
            'add: bar.txt, mod foo.txt',
            '--branch',
            'test_brunch',
            '--no-warnings',
        ]);

        await fossil.exec(cwd, ['up', 'trunk']);
        await fossil.exec(cwd, ['merge', 'test_brunch']);
        const model = vscode.extensions.getExtension('koog1000.fossil')!
            .exports as Model;
        const repository = model.repositories[0];
        await eventToPromise(repository.onDidRunOperation);
        await repository.status();
        assertGroups(
            repository,
            new Map([
                [barPath, Status.ADDED],
                [fooPath, Status.MODIFIED],
            ]),
            new Map()
        );
    }).timeout(10000);
});
