import * as vscode from 'vscode';
import { Uri } from 'vscode';
import * as sinon from 'sinon';
import { FossilExecutable, FossilCWD } from '../../fossilExecutable';
import * as fs from 'fs';
import { Repository } from '../../repository';
import { FossilResourceGroup } from '../../resourceGroups';
import * as assert from 'assert/strict';
import { getRepository } from './common';
import { ResourceStatus } from '../../openedRepository';

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

export async function status_missing_is_visible_in_source_control_panel(
    sandbox: sinon.SinonSandbox,
    executable: FossilExecutable
): Promise<void> {
    const filename = 'smiviscp.txt';
    const rootUri = vscode.workspace.workspaceFolders![0].uri;
    const cwd = rootUri.fsPath as FossilCWD;
    const fooPath = Uri.joinPath(rootUri, filename).fsPath;
    await fs.promises.writeFile(fooPath, 'test\n');
    const addRes = await executable.exec(cwd, ['add', filename]);
    assert.equal(addRes.stdout, `ADDED  ${filename}\n`);
    await executable.exec(cwd, [
        'commit',
        '-m',
        `add: ${filename}`,
        '--no-warnings',
    ]);
    await fs.promises.unlink(fooPath);
    const repository = getRepository();
    await repository.updateModelState();
    assertGroups(
        repository,
        new Map([[fooPath, ResourceStatus.MISSING]]),
        new Map()
    );
}

export async function status_rename_is_visible_in_source_control_panel(
    sandbox: sinon.SinonSandbox,
    executable: FossilExecutable
): Promise<void> {
    const oldFilename = 'sriciscp-new.txt';
    const newFilename = 'sriciscp-renamed.txt';
    const rootUri = vscode.workspace.workspaceFolders![0].uri;
    const cwd = rootUri.fsPath as FossilCWD;
    await executable.exec(cwd, ['revert']);
    const fooPath = Uri.joinPath(rootUri, oldFilename).fsPath;
    await fs.promises.writeFile(fooPath, 'test\n');
    const addRes = await executable.exec(cwd, ['add', oldFilename]);
    assert.equal(addRes.stdout, `ADDED  ${oldFilename}\n`);
    const repository = getRepository();
    await repository.updateModelState();
    assertGroups(
        repository,
        new Map([[fooPath, ResourceStatus.ADDED]]),
        new Map()
    );

    await executable.exec(cwd, [
        'commit',
        '-m',
        `add: ${newFilename}`,
        '--no-warnings',
    ]);
    await repository.updateModelState();
    assertGroups(repository, new Map(), new Map());

    await executable.exec(cwd, ['mv', oldFilename, newFilename, '--hard']);
    await repository.updateModelState();
    const barPath = Uri.joinPath(rootUri, newFilename).fsPath;
    assertGroups(
        repository,
        new Map([[barPath, ResourceStatus.RENAMED]]),
        new Map()
    );
}

export async function status_merge_integrate_is_visible_in_source_control_panel(
    sandbox: sinon.SinonSandbox,
    executable: FossilExecutable
): Promise<void> {
    const rootUri = vscode.workspace.workspaceFolders![0].uri;
    const cwd = rootUri.fsPath as FossilCWD;
    const fooPath = Uri.joinPath(rootUri, 'foo-xa.txt').fsPath;

    await fs.promises.writeFile(fooPath, 'test\n');
    await executable.exec(cwd, ['add', 'foo-xa.txt']);
    await executable.exec(cwd, [
        'commit',
        '-m',
        'add: foo-xa.txt',
        '--no-warnings',
    ]);
    const barPath = Uri.joinPath(rootUri, 'bar-xa.txt').fsPath;
    await fs.promises.writeFile(barPath, 'test bar\n');
    await fs.promises.appendFile(fooPath, 'appended\n');
    await executable.exec(cwd, ['add', 'bar-xa.txt']);
    console.log;
    await executable.exec(cwd, [
        'commit',
        '-m',
        'add: bar-xa.txt, mod foo-xa.txt',
        '--branch',
        'test_brunch',
        '--no-warnings',
    ]);

    await executable.exec(cwd, ['update', 'trunk']);
    await executable.exec(cwd, ['merge', 'test_brunch']);
    const repository = getRepository();
    await repository.updateModelState();
    assertGroups(
        repository,
        new Map([
            [barPath, ResourceStatus.ADDED],
            [fooPath, ResourceStatus.MODIFIED],
        ]),
        new Map()
    );
}
