import * as vscode from 'vscode';
import { Uri } from 'vscode';
import * as sinon from 'sinon';
import { Fossil, FossilCWD } from '../../fossilBase';
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
    fossil: Fossil
): Promise<void> {
    await fossilInit(sandbox, fossil);
    await fossilOpen(sandbox, fossil);
    const rootUri = vscode.workspace.workspaceFolders![0].uri;
    const cwd = rootUri.fsPath as FossilCWD;
    const fooPath = Uri.joinPath(rootUri, 'foo.txt').fsPath;
    await fs.promises.writeFile(fooPath, 'test\n');
    await fossil.exec(cwd, ['add', 'foo.txt']);
    await fossil.exec(cwd, ['commit', '-m', 'add: foo.txt', '--no-warnings']);
    await fs.promises.unlink(fooPath);
    const model = vscode.extensions.getExtension('koog1000.fossil')!
        .exports as Model;
    const repository = model.repositories[0];
    await eventToPromise(repository.onDidRunOperation);
    await repository.status();
    assertGroups(repository, new Map([[fooPath, Status.MISSING]]), new Map());
}

export async function status_rename_is_visible_in_source_control_panel(
    sandbox: sinon.SinonSandbox,
    fossil: Fossil
): Promise<void> {
    await fossilInit(sandbox, fossil);
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

    await fossil.exec(cwd, ['commit', '-m', 'add: foo.txt', '--no-warnings']);
    await repository.status();
    assertGroups(repository, new Map(), new Map());

    await fossil.exec(cwd, ['mv', 'foo.txt', 'bar.txt', '--hard']);
    await repository.status();
    await eventToPromise(repository.onDidRunOperation);
    const barPath = Uri.joinPath(rootUri, 'bar.txt').fsPath;
    assertGroups(repository, new Map([[barPath, Status.RENAMED]]), new Map());
}

export async function status_merge_integrate_is_visible_in_source_control_panel(
    sandbox: sinon.SinonSandbox,
    fossil: Fossil
): Promise<void> {
    await fossilInit(sandbox, fossil);
    await fossilOpen(sandbox, fossil);
    const rootUri = vscode.workspace.workspaceFolders![0].uri;
    const cwd = rootUri.fsPath as FossilCWD;
    const fooPath = Uri.joinPath(rootUri, 'foo.txt').fsPath;

    await fs.promises.writeFile(fooPath, 'test\n');
    await fossil.exec(cwd, ['add', 'foo.txt']);
    await fossil.exec(cwd, ['commit', '-m', 'add: foo.txt', '--no-warnings']);
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
}
