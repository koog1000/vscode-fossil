import * as assert from 'assert/strict';
import { window, Uri } from 'vscode';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as fs from 'fs';
import {
    FossilExecutable,
    FossilCWD,
    FossilArgs,
    FossilStdErr,
    FossilStdOut,
    FossilExecutablePath,
    ExecResult,
} from '../../fossilExecutable';
import { Model } from '../../model';
import { Repository } from '../../repository';
import { OpenedRepository, ResourceStatus } from '../../openedRepository';
import { FossilResourceGroup } from '../../resourceGroups';
import { delay } from '../../util';

export type SinonStubT<T extends (...args: any) => any> = sinon.SinonStub<
    Parameters<T>,
    ReturnType<T>
>;

export async function cleanRoot(): Promise<void> {
    /* c8 ignore next 5 */
    if (!vscode.workspace.workspaceFolders) {
        throw new Error(
            'Expected opened workspace. Probably setup issue and `out/test/test_repo` does not exist.'
        );
    }

    const rootPath = vscode.workspace.workspaceFolders[0].uri;
    const entities = await fs.promises.readdir(rootPath.fsPath);
    await Promise.all(
        entities.map(name =>
            fs.promises.rm(Uri.joinPath(rootPath, name).fsPath, {
                force: true,
                recursive: true,
            })
        )
    );
}

export async function fossilInit(sandbox: sinon.SinonSandbox): Promise<void> {
    const fossilVersion = getExecutable().version;
    assert.ok(vscode.workspace.workspaceFolders);
    const fossilPath = Uri.joinPath(
        vscode.workspace.workspaceFolders[0].uri,
        '/test.fossil'
    );
    assert.ok(
        !fs.existsSync(fossilPath.fsPath),
        `repo '${fossilPath.fsPath}' already exists`
    );

    const showSaveDialogStub = sandbox
        .stub(window, 'showSaveDialog')
        .withArgs(sinon.match({ title: 'Select New Fossil File Location' }))
        .resolves(fossilPath);

    const showInformationMessage: sinon.SinonStub = sandbox.stub(
        window,
        'showInformationMessage'
    );
    const openRepositoryQuestion = showInformationMessage
        .withArgs(
            'Would you like to open the cloned repository?',
            'Open Repository'
        )
        .resolves();

    const showInputBox = sandbox.stub(window, 'showInputBox');
    if (fossilVersion >= [2, 18]) {
        showInputBox
            .withArgs(sinon.match({ prompt: 'Project Name' }))
            .resolves('Test repo name');
        showInputBox
            .withArgs(sinon.match({ prompt: 'Project Description' }))
            .resolves('Test repo description');
    }

    await vscode.commands.executeCommand('fossil.init');
    sinon.assert.calledOnce(showSaveDialogStub);
    if (fossilVersion >= [2, 18]) {
        sinon.assert.calledTwice(showInputBox);
    } else {
        sinon.assert.notCalled(showInputBox);
    }
    assert.ok(
        fs.existsSync(fossilPath.fsPath),
        `Not a file: '${fossilPath.fsPath}' even though 'fossil.init' was successfully executed`
    );
    sinon.assert.calledOnce(openRepositoryQuestion);
    sandbox.restore();
}

export function getRepository(): Repository {
    const extension = vscode.extensions.getExtension('koog1000.fossil');
    assert.ok(extension);
    const model = extension.exports as Model;
    assert.equal(model.repositories.length, 1);
    return model.repositories[0];
}

export function getExecutable(): FossilExecutable {
    const extension = vscode.extensions.getExtension('koog1000.fossil');
    assert.ok(extension);
    const model = extension.exports as Model;
    assert.ok(model, "extension initialization didn't succeed");
    const executable = model['executable'];
    assert.ok(executable);
    return executable;
}

export type ExecStub = SinonStubT<OpenedRepository['exec']>;
export function getExecStub(sandbox: sinon.SinonSandbox): ExecStub {
    const repository = getRepository();
    const openedRepository: OpenedRepository = (repository as any).repository;
    return sandbox.stub(openedRepository, 'exec').callThrough();
}

type RawExecFunc = FossilExecutable['rawExec'];
type RawExecStub = SinonStubT<RawExecFunc>;
export function getRawExecStub(sandbox: sinon.SinonSandbox): RawExecStub {
    const repository = getRepository();
    const executable: FossilExecutable = (repository as any).repository
        .executable;
    return sandbox.stub(executable, 'rawExec').callThrough();
}

export function fakeExecutionResult({
    stdout,
    stderr,
    args,
    exitCode,
}: {
    stdout?: string;
    stderr?: string;
    args?: FossilArgs;
    exitCode?: number;
} = {}): ExecResult {
    return {
        fossilPath: '' as FossilExecutablePath,
        exitCode: exitCode ?? 0,
        stdout: (stdout ?? '') as FossilStdOut,
        stderr: (stderr ?? '') as FossilStdErr,
        args: args ?? ['status'],
        cwd: '' as FossilCWD,
    } as ExecResult;
}

export function fakeRawExecutionResult({
    stdout,
    stderr,
    args,
    exitCode,
}: {
    stdout?: string;
    stderr?: string;
    args?: FossilArgs;
    exitCode?: 0 | 1;
} = {}): Awaited<ReturnType<RawExecFunc>> {
    return {
        fossilPath: '' as FossilExecutablePath,
        exitCode: exitCode ?? 0,
        stdout: Buffer.from(stdout ?? ''),
        stderr: Buffer.from(stderr ?? ''),
        args: args ?? ['status'],
        cwd: '' as FossilCWD,
    };
}

export function fakeFossilStatus(execStub: ExecStub, status: string): ExecStub {
    const header =
        'checkout:     0000000000000000000000000000000000000000 2023-05-26 12:43:56 UTC\n' +
        'parent:       0000000000000000000000000000000000000001 2023-05-26 12:43:56 UTC\n' +
        'tags:         trunk, this is a test, custom tag\n';
    const args: FossilArgs = ['status', '--differ', '--merge'];
    execStub
        .withArgs(['branch', 'current'])
        .resolves(fakeExecutionResult({ stdout: 'trunk' }));
    return execStub
        .withArgs(args)
        .resolves(fakeExecutionResult({ stdout: header + status, args }));
}

async function setupFossilOpen(sandbox: sinon.SinonSandbox) {
    assert.ok(vscode.workspace.workspaceFolders);
    const rootPath = vscode.workspace.workspaceFolders[0].uri;
    const fossilPath = Uri.joinPath(rootPath, '/test.fossil');
    assert.ok(
        fs.existsSync(fossilPath.fsPath),
        `repo '${fossilPath.fsPath}' must exist`
    );

    const executable = getExecutable();
    const openStub = sandbox
        .stub(executable, 'exec')
        .callThrough()
        .withArgs(
            rootPath.fsPath as FossilCWD,
            sinon.match.array.startsWith(['open'])
        );
    const sod = sandbox.stub(window, 'showOpenDialog');
    sod.onFirstCall().resolves([fossilPath]);
    sod.onSecondCall().resolves([rootPath]);
    return {
        rootPath,
        fossilPath,
        executable,
        openStub,
        sod,
    };
}

export async function fossilOpen(sandbox: sinon.SinonSandbox): Promise<void> {
    const { rootPath, fossilPath, executable, openStub, sod } =
        await setupFossilOpen(sandbox);

    await vscode.commands.executeCommand('fossil.open');
    sinon.assert.calledTwice(sod);
    sinon.assert.calledOnceWithExactly(openStub, rootPath.fsPath as FossilCWD, [
        'open',
        fossilPath.fsPath,
    ]);
    const res = await executable.exec(rootPath.fsPath as FossilCWD, ['info']);
    assert.match(res.stdout, /check-ins:\s+1\s*$/);
    sandbox.restore();
}

export async function fossilOpenForce(
    sandbox: sinon.SinonSandbox
): Promise<void> {
    const { rootPath, fossilPath, executable, openStub, sod } =
        await setupFossilOpen(sandbox);

    const swm = (
        sandbox.stub(window, 'showWarningMessage') as sinon.SinonStub
    ).resolves('&&Open Repository');

    await vscode.commands.executeCommand('fossil.open');
    sinon.assert.calledTwice(sod);
    sinon.assert.calledOnceWithExactly(
        swm,
        `The directory ${rootPath.fsPath} is not empty.\n` +
            'Open repository here anyway?',
        { modal: true },
        '&&Open Repository'
    );
    sinon.assert.calledTwice(openStub);
    sinon.assert.calledWithExactly(
        openStub.firstCall,
        rootPath.fsPath as FossilCWD,
        ['open', fossilPath.fsPath]
    );
    sinon.assert.calledWithExactly(
        openStub.secondCall,
        rootPath.fsPath as FossilCWD,
        ['open', fossilPath.fsPath, '--force']
    );
    // on some systems 'info' is not available immediately
    let res: ExecResult;
    for (let i = 0; i < 10; ++i) {
        res = await executable.exec(rootPath.fsPath as FossilCWD, ['info']);
        if (/check-ins:\s+1\s*$/.test(res.stdout)) {
            break;
        }
        await delay((i + 1) * 111);
    }
    assert.match(res!.stdout, /check-ins:\s+1\s*$/);
    sandbox.restore();
}

export async function add(
    filename: string,
    content: string,
    commitMessage: string,
    action: 'ADDED' | 'SKIP' = 'ADDED'
): Promise<Uri> {
    const repository = getRepository();
    const openedRepository: OpenedRepository = (repository as any).repository;

    const rootUri = vscode.workspace.workspaceFolders![0].uri;
    const fileUri = Uri.joinPath(rootUri, filename);
    await fs.promises.writeFile(fileUri.fsPath, content);
    const addRes = await openedRepository.exec(['add', filename]);
    assert.match(
        addRes.stdout.trimEnd(),
        new RegExp(`${action}\\s+${filename}`)
    );
    await openedRepository.exec(['commit', filename, '-m', commitMessage]);
    return fileUri;
}

export async function cleanupFossil(repository: Repository): Promise<void> {
    const openedRepository: OpenedRepository = (repository as any).repository;
    if (
        repository.workingGroup.resourceStates.length ||
        repository.stagingGroup.resourceStates.length
    ) {
        await openedRepository.exec(['clean']);
        await openedRepository.exec(['revert']);
        await repository.updateModelState();
        assert.equal(repository.workingGroup.resourceStates.length, 0);
        assert.equal(repository.stagingGroup.resourceStates.length, 0);
    }
    for (const group of vscode.window.tabGroups.all) {
        const allClosed = await vscode.window.tabGroups.close(group);
        assert.ok(allClosed);
    }
}

export function assertGroups(
    repository: Repository,
    working: Map<string, ResourceStatus>,
    staging: Map<string, ResourceStatus>
): void {
    const to_map = (grp: FossilResourceGroup) => {
        return new Map<string, ResourceStatus>(
            grp.resourceStates.map(res => [res.resourceUri.fsPath, res.status])
        );
    };
    assert.deepStrictEqual(to_map(repository.workingGroup), working);
    assert.deepStrictEqual(to_map(repository.stagingGroup), staging);
}
