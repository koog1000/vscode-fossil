import * as vscode from 'vscode';
import { Uri } from 'vscode';
import * as sinon from 'sinon';
import { FossilExecutable, FossilCWD } from '../../fossilExecutable';
import { fossilInit, fossilOpen } from './common';
import * as fs from 'fs';
import { eventToPromise } from '../../util';
import { Model } from '../../model';
import { Repository, Status } from '../../repository';
import { FossilResourceGroup } from '../../resourceGroups';
import * as assert from 'assert/strict';

export function assertGroups(
    repository: Repository,
    working: Map<string, Status>,
    staging: Map<string, Status>
): void {
    const to_map = (grp: FossilResourceGroup) => {
        return new Map<string, Status>(
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
    await fossilInit(sandbox, executable);
    await fossilOpen(sandbox, executable);
    const rootUri = vscode.workspace.workspaceFolders![0].uri;
    const cwd = rootUri.fsPath as FossilCWD;
    const fooPath = Uri.joinPath(rootUri, 'foo.txt').fsPath;
    await fs.promises.writeFile(fooPath, 'test\n');
    await executable.exec(cwd, ['add', 'foo.txt']);
    await executable.exec(cwd, [
        'commit',
        '-m',
        'add: foo.txt',
        '--no-warnings',
    ]);
    await fs.promises.unlink(fooPath);
    const model = vscode.extensions.getExtension('koog1000.fossil')!
        .exports as Model;
    const repository = model.repositories[0];
    await eventToPromise(repository.onDidRunOperation);
    await repository.status('test');
    assertGroups(repository, new Map([[fooPath, Status.MISSING]]), new Map());
}

export async function status_rename_is_visible_in_source_control_panel(
    sandbox: sinon.SinonSandbox,
    executable: FossilExecutable
): Promise<void> {
    await fossilInit(sandbox, executable);
    await fossilOpen(sandbox, executable);
    const rootUri = vscode.workspace.workspaceFolders![0].uri;
    const cwd = rootUri.fsPath as FossilCWD;
    const fooPath = Uri.joinPath(rootUri, 'foo.txt').fsPath;
    await fs.promises.writeFile(fooPath, 'test\n');
    await executable.exec(cwd, ['add', 'foo.txt']);
    const model = vscode.extensions.getExtension('koog1000.fossil')!
        .exports as Model;
    const repository = model.repositories[0];
    await eventToPromise(repository.onDidRunOperation);
    await repository.status('test');
    assertGroups(repository, new Map([[fooPath, Status.ADDED]]), new Map());

    await executable.exec(cwd, [
        'commit',
        '-m',
        'add: foo.txt',
        '--no-warnings',
    ]);
    await repository.status('test');
    assertGroups(repository, new Map(), new Map());

    await executable.exec(cwd, ['mv', 'foo.txt', 'bar.txt', '--hard']);
    await repository.status('test');
    await eventToPromise(repository.onDidRunOperation);
    const barPath = Uri.joinPath(rootUri, 'bar.txt').fsPath;
    assertGroups(repository, new Map([[barPath, Status.RENAMED]]), new Map());
}

export async function status_merge_integrate_is_visible_in_source_control_panel(
    sandbox: sinon.SinonSandbox,
    executable: FossilExecutable
): Promise<void> {
    await fossilInit(sandbox, executable);
    await fossilOpen(sandbox, executable);
    const rootUri = vscode.workspace.workspaceFolders![0].uri;
    const cwd = rootUri.fsPath as FossilCWD;
    const fooPath = Uri.joinPath(rootUri, 'foo.txt').fsPath;

    await fs.promises.writeFile(fooPath, 'test\n');
    await executable.exec(cwd, ['add', 'foo.txt']);
    await executable.exec(cwd, [
        'commit',
        '-m',
        'add: foo.txt',
        '--no-warnings',
    ]);
    const barPath = Uri.joinPath(rootUri, 'bar.txt').fsPath;
    await fs.promises.writeFile(barPath, 'test bar\n');
    await fs.promises.appendFile(fooPath, 'appended\n');
    await executable.exec(cwd, ['add', 'bar.txt']);
    console.log;
    await executable.exec(cwd, [
        'commit',
        '-m',
        'add: bar.txt, mod foo.txt',
        '--branch',
        'test_brunch',
        '--no-warnings',
    ]);

    await executable.exec(cwd, ['up', 'trunk']);
    await executable.exec(cwd, ['merge', 'test_brunch']);
    const model = vscode.extensions.getExtension('koog1000.fossil')!
        .exports as Model;
    const repository = model.repositories[0];
    await eventToPromise(repository.onDidRunOperation);
    await repository.status('test');
    assertGroups(
        repository,
        new Map([
            [barPath, Status.ADDED],
            [fooPath, Status.MODIFIED],
        ]),
        new Map()
    );
}
