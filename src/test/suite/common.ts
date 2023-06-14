import * as assert from 'assert/strict';
import { window, Uri } from 'vscode';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as fs from 'fs';
import {
    FossilExecutable,
    FossilCWD,
    IExecutionResult,
    FossilArgs,
    FossilStdErr,
    FossilStdOut,
    FossilExecutablePath,
} from '../../fossilExecutable';
import { Model } from '../../model';
import { Repository } from '../../repository';
import { OpenedRepository, ResourceStatus } from '../../openedRepository';
import { FossilResourceGroup } from '../../resourceGroups';

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
        vscode.workspace.workspaceFolders![0].uri,
        '/test.fossil'
    );
    assert.ok(
        !fs.existsSync(fossilPath.fsPath),
        `repo '${fossilPath.fsPath}' already exists`
    );

    const showSaveDialogstub = sandbox
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
    sinon.assert.calledOnce(showSaveDialogstub);
    if (fossilVersion >= [2, 18]) {
        sinon.assert.calledTwice(showInputBox);
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
    assert.ok(model.repositories.length);
    return model.repositories[0];
}

export function getExecutable(): FossilExecutable {
    const extension = vscode.extensions.getExtension('koog1000.fossil');
    assert.ok(extension);
    const model = extension.exports as Model;
    const executable = model['executable'];
    assert.ok(executable);
    return executable;
}

type ExecFunc = OpenedRepository['exec'];
type ExecStub = sinon.SinonStub<Parameters<ExecFunc>, ReturnType<ExecFunc>>;
export function getExecStub(sandbox: sinon.SinonSandbox): ExecStub {
    const repository = getRepository();
    const openedRepository: OpenedRepository = (repository as any).repository;
    return sandbox.stub(openedRepository, 'exec').callThrough();
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
} = {}): IExecutionResult {
    return {
        fossilPath: '' as FossilExecutablePath,
        exitCode: exitCode ?? 0,
        stdout: (stdout ?? '') as FossilStdOut,
        stderr: (stderr ?? '') as FossilStdErr,
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
    return execStub
        .withArgs(args)
        .resolves(fakeExecutionResult({ stdout: header + status, args }));
}

export async function fossilOpen(sandbox: sinon.SinonSandbox): Promise<void> {
    assert.ok(vscode.workspace.workspaceFolders);
    const rootPath = vscode.workspace.workspaceFolders[0].uri;
    const fossilPath = Uri.joinPath(rootPath, '/test.fossil');
    assert.ok(
        fs.existsSync(fossilPath.fsPath),
        `repo '${fossilPath.fsPath}' must exist`
    );

    const showInformationMessage = sandbox.stub(window, 'showOpenDialog');
    showInformationMessage.onFirstCall().resolves([fossilPath]);
    showInformationMessage.onSecondCall().resolves([rootPath]);

    await vscode.commands.executeCommand('fossil.open');
    sinon.assert.calledTwice(showInformationMessage);
    const executable = getExecutable();
    const res = await executable.exec(rootPath.fsPath as FossilCWD, ['info']);
    assert.match(res.stdout, /check-ins:\s+1\s*$/);
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
