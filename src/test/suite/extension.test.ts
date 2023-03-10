import { before, afterEach, beforeEach } from 'mocha';
import { window, Uri } from 'vscode';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as fs from 'fs';
import { FossilExecutable } from '../../fossilExecutable';
import { findFossil } from '../../fossilFinder';
import {
    status_merge_integrate_is_visible_in_source_control_panel,
    status_missing_is_visible_in_source_control_panel,
    status_rename_is_visible_in_source_control_panel,
} from './test_status';
import { fossil_close, fossil_merge } from './test_commands';
import { fossil_file_log_can_diff_files } from './test_log';
import { fossilInit, fossilOpen } from './common';
import {
    fossil_undo_and_redo_warning,
    fossil_undo_and_redo_working,
} from './test_undo_redo';
import { error_is_thrown_when_executing_unknown_command } from './test_utils';

async function createFossil(): Promise<FossilExecutable> {
    const outputChannel = window.createOutputChannel('Fossil.Test');
    const info = await findFossil(null, outputChannel);
    const executable = new FossilExecutable({
        fossilPath: info.path,
        version: info.version,
        outputChannel: outputChannel,
    });
    return executable;
}

suite('Fossil', () => {
    const sandbox = sinon.createSandbox();
    let executable: FossilExecutable;
    before(async () => {
        executable = await createFossil();
    });
    beforeEach(async () => {
        if (!vscode.workspace.workspaceFolders) {
            throw new Error('Expected opened workspace. Probably setup issue.');
        }
        const rootPath = vscode.workspace.workspaceFolders[0].uri;
        const entities = await fs.promises.readdir(rootPath.fsPath);
        await Promise.all(
            entities.map(name =>
                fs.promises.unlink(Uri.joinPath(rootPath, name).fsPath)
            )
        );
    });

    afterEach(() => {
        sandbox.restore();
    });

    test('fossil.error', async () => {
        await error_is_thrown_when_executing_unknown_command(
            sandbox,
            executable
        );
    });

    test('fossil.init', async () => {
        await fossilInit(sandbox, executable);
    });

    test('fossil.open', async () => {
        await fossilInit(sandbox, executable);
        await fossilOpen(sandbox, executable);
    });

    test('fossil.merge', () => fossil_merge(sandbox, executable)).timeout(
        14000
    );

    test('fossil.close', () => fossil_close(sandbox, executable));

    test('fossil missing is visible in Source Control panel', async () =>
        status_missing_is_visible_in_source_control_panel(
            sandbox,
            executable
        )).timeout(5000);

    test('fossil rename is visible in Source Control panel', () =>
        status_rename_is_visible_in_source_control_panel(
            sandbox,
            executable
        )).timeout(15000);

    test('fossil integrate is visible in Source Control panel', () =>
        status_merge_integrate_is_visible_in_source_control_panel(
            sandbox,
            executable
        )).timeout(10000);
    test('fossil file log can differ files', () =>
        fossil_file_log_can_diff_files(sandbox, executable)).timeout(10000);
    test('fossil undo and redo warning', () =>
        fossil_undo_and_redo_warning(sandbox, executable)).timeout(5000);
    test('fossil undo and redo working', () =>
        fossil_undo_and_redo_working(sandbox, executable)).timeout(15000);
});
