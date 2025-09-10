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
    Reason,
} from '../../fossilExecutable';
import { Model } from '../../model';
import { Repository } from '../../repository';
import {
    FossilCommitMessage,
    FossilPath,
    OpenedRepository,
    RelativePath,
    ResourceStatus,
} from '../../openedRepository';
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

export function getModel(): Model {
    const extension = vscode.extensions.getExtension('koog1000.fossil');
    assert.ok(extension);
    const model = extension.exports as Model;
    assert.ok(model, "extension initialization didn't succeed");
    return model;
}

export function getRepository(): Repository {
    const model = getModel();
    assert.equal(model.repositories.length, 1);
    return model.repositories[0];
}

export function getExecutable(): FossilExecutable {
    const model = getModel();
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
        args: args ?? ['status', '--differ', '--merge'],
        cwd: '' as FossilCWD,
    };
}

export function fakeStatusResult(status: string): ExecResult {
    const args: FossilArgs = ['status', '--differ', '--merge'];
    const header =
        'checkout:     0000000000000000000000000000000000000000 2023-05-26 12:43:56 UTC\n' +
        'parent:       0000000000000000000000000000000000000001 2023-05-26 12:43:56 UTC\n' +
        'tags:         trunk, this is a test, custom tag\n';
    return fakeExecutionResult({ stdout: header + status, args });
}

export function fakeFossilStatus(execStub: ExecStub, status: string): ExecStub {
    return execStub
        .withArgs(['status', '--differ', '--merge'])
        .resolves(fakeStatusResult(status));
}

export function fakeFossilBranch(
    execStub: ExecStub,
    branch: 'refresh' | 'trunk'
): ExecStub {
    return execStub
        .withArgs(['branch', 'current'])
        .resolves(fakeExecutionResult({ stdout: branch }));
}

type Changes = `${number} files modified.` | 'None. Already up-to-date';

export function fakeUpdateResult(
    changes: Changes = 'None. Already up-to-date'
) {
    return fakeExecutionResult({ stdout: `changes: ${changes}\n` });
}

export function fakeFossilChanges(
    execStub: ExecStub,
    changes: Changes = 'None. Already up-to-date'
): ExecStub {
    return execStub
        .withArgs(['update', '--dry-run'])
        .resolves(fakeUpdateResult(changes));
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
    const repository = getRepository();
    const rootUri = vscode.workspace.workspaceFolders![0].uri;
    sinon.assert.calledTwice(sod);
    sinon.assert.calledWith(sod.firstCall, {
        defaultUri: sinon.match({
            scheme: 'file',
            authority: '',
            path: Uri.joinPath(rootUri, 'test_repo.fossil').fsPath,
        }) as any,
        openLabel: 'Repository Location',
        filters: { 'Fossil Files': ['fossil'], 'All files': ['*'] },
        canSelectMany: false,
    });
    sinon.assert.calledWith(sod.secondCall, {
        defaultUri: sinon.match({
            scheme: 'file',
            authority: '',
            path: rootUri.fsPath,
        }) as any,
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        title: 'Select Fossil Root Directory',
    });
    sinon.assert.calledOnceWithExactly(openStub, rootPath.fsPath as FossilCWD, [
        'open',
        fossilPath.fsPath as FossilPath,
    ]);
    const res = await executable.exec(rootPath.fsPath as FossilCWD, ['info']);
    assert.match(res.stdout, /check-ins:\s+1\s*$/);

    for (let i = 0; i < 1500; ++i) {
        // wait for repository full initialization, i.e.
        // successful `repository.updateAutoSyncInterval` call
        if (repository['autoSyncTimer'] !== undefined) {
            break;
        }
        /* c8 ignore next 2*/
        await delay(3);
    }
    assert.notEqual(repository['autoSyncTimer'], undefined);
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
        ['open', fossilPath.fsPath as FossilPath]
    );
    sinon.assert.calledWithExactly(
        openStub.secondCall,
        rootPath.fsPath as FossilCWD,
        ['open', fossilPath.fsPath as FossilPath, '--force']
    );
    // on some systems 'info' is not available immediately
    let res: ExecResult;
    for (let i = 0; i < 10; ++i) {
        res = await executable.exec(rootPath.fsPath as FossilCWD, ['info']);
        if (/check-ins:\s+1\s*$/.test(res.stdout)) {
            break;
        }
        /* c8 ignore next 2 */
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
    const addRes = await openedRepository.exec([
        'add',
        '--',
        filename as RelativePath,
    ]);
    assert.match(
        addRes.stdout.trimEnd(),
        new RegExp(`${action}\\s+${filename}`)
    );
    const commitRes = await openedRepository.exec([
        'commit',
        '-m',
        commitMessage as FossilCommitMessage,
        '--',
        filename as RelativePath,
    ]);
    assert.equal(commitRes.exitCode, 0, 'Commit failed');
    return fileUri;
}

export async function cleanupFossil(repository: Repository): Promise<void> {
    const openedRepository: OpenedRepository = (repository as any).repository;
    if (
        repository.workingGroup.resourceStates.length ||
        repository.stagingGroup.resourceStates.length ||
        repository.untrackedGroup.resourceStates.length
    ) {
        const revertRes = await openedRepository.exec(['revert', '--']);
        assert.equal(revertRes.exitCode, 0);

        const cleanRes1 = await openedRepository.exec(
            ['clean', '--verbose'],
            'Test: cleanupFossil' as Reason
        );
        assert.equal(cleanRes1.exitCode, 0);

        const updateRes = await repository.updateStatus(
            'Test: cleanupFossil' as Reason
        );
        assert.equal(updateRes, undefined);
        // if we fail on the next line, it could be that there's fake status
        assertGroups(repository, {}, 'Cleanup failed inside `cleanupFossil`');
    } else {
        assertGroups(repository, {}, 'Totally unexpected state');
    }
    for (const group of vscode.window.tabGroups.all) {
        const allClosed = await vscode.window.tabGroups.close(group);
        assert.ok(allClosed);
    }
}

export function assertGroups(
    repository: Repository,
    groups: {
        working?: Readonly<[string, ResourceStatus]>[];
        staging?: Readonly<[string, ResourceStatus]>[];
        untracked?: Readonly<[string, ResourceStatus]>[];
        conflict?: Readonly<[string, ResourceStatus]>[];
    },
    message?: string
): void {
    const group_to_map = (grp: FossilResourceGroup) => {
        return new Map<string, ResourceStatus>(
            grp.resourceStates.map(res => [res.resourceUri.fsPath, res.status])
        );
    };
    assert.deepStrictEqual(
        new Map([
            ['working', group_to_map(repository.workingGroup)],
            ['staging', group_to_map(repository.stagingGroup)],
            ['untracked', group_to_map(repository.untrackedGroup)],
            ['conflict', group_to_map(repository.conflictGroup)],
        ]),
        new Map([
            ['working', new Map(groups.working)],
            ['staging', new Map(groups.staging)],
            ['untracked', new Map(groups.untracked)],
            ['conflict', new Map(groups.conflict)],
        ]),
        message
    );
}

export function statusBarCommands() {
    const repository = getRepository();
    const commands = repository.sourceControl.statusBarCommands;
    assert.ok(commands);
    return commands;
}

export function stubFossilConfig(sandbox: sinon.SinonSandbox) {
    const configStub = {
        update: sinon.stub(),
        get: sinon.stub(),
    };
    configStub.get.withArgs('username').returns('');
    configStub.get.withArgs('confirmGitExport').returns(null);
    configStub.get.withArgs('enableRenaming').returns(true);
    configStub.get.withArgs('path').returns('');
    configStub.get.withArgs('globalArgs').returns([]);
    configStub.get.withArgs('commitArgs').returns([]);
    configStub.get.callsFake((...args: any[]) => {
        throw new Error(`get: called with ${JSON.stringify(args)}`);
    });
    configStub.update.callsFake((...args: any[]) => {
        throw new Error(`update: called with ${JSON.stringify(args)}`);
    });

    sandbox
        .stub(vscode.workspace, 'getConfiguration')
        .callThrough()
        .withArgs('fossil')
        .returns(configStub as any);
    return configStub;
}
