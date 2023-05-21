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
import {
    fossil_add,
    fossil_branch_suite,
    fossil_change_branch_to_hash,
    fossil_change_branch_to_trunk,
    fossil_clean,
    fossil_close,
    fossil_commit_suite,
    fossil_ignore,
    fossil_merge_suite,
    fossil_open_files,
    fossil_open_resource,
    fossil_patch_suite,
    fossil_pull_with_autoUpdate_off,
    fossil_pull_with_autoUpdate_on,
    fossil_rename_a_directory,
    fossil_rename_a_file,
    fossil_revert_change,
    fossil_revert_suite,
    fossil_stage_suite,
    fossil_stash_suite,
    fossil_tag_suite,
    fossil_utilities_suite,
} from './test_commands';
import {
    fossil_can_amend_commit_message,
    fossil_file_log_can_diff_files,
} from './test_log';
import { fossilInit, fossilOpen } from './common';
import {
    fossil_undo_and_redo_warning,
    fossil_undo_and_redo_working,
} from './test_undo_redo';
import {
    error_is_thrown_when_executing_unknown_command,
    error_to_string_is_valid,
} from './test_utils';

async function createFossil(): Promise<FossilExecutable> {
    const outputChannel = window.createOutputChannel('Fossil.Test');
    return findFossil(null, outputChannel);
}

async function cleanRoot() {
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

suite('Fossil.NoRepoRequired', () => {
    const sandbox = sinon.createSandbox();
    let executable: FossilExecutable;
    before(async () => {
        executable = await createFossil();
    });
    test('Error is thrown when executing unknown command', async () => {
        await error_is_thrown_when_executing_unknown_command(
            sandbox,
            executable
        );
    });
    test('Error to string is valid', error_to_string_is_valid);
});

suite('Fossil.EveryTestFromEmptyState', () => {
    const sandbox = sinon.createSandbox();
    let executable: FossilExecutable;
    before(async () => {
        executable = await createFossil();
    });
    beforeEach(cleanRoot);

    afterEach(() => {
        sandbox.restore();
    });

    test('fossil.init', async () => {
        await fossilInit(sandbox, executable);
    });

    test('fossil.close', () => fossil_close(sandbox, executable)).timeout(5000);
});

suite('Fossil.OpenedRepo', function () {
    const sandbox = sinon.createSandbox();
    let executable: FossilExecutable;
    before(async function () {
        this.timeout(5555);
        await cleanRoot();
        executable = await createFossil();
        await fossilInit(sandbox, executable);
        await fossilOpen(sandbox, executable);
    });

    test('fossil undo and redo warning', () =>
        // this test requires just initialized state
        fossil_undo_and_redo_warning(sandbox)).timeout(5000);

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

    test('fossil undo and redo working', () =>
        fossil_undo_and_redo_working(sandbox)).timeout(15000);

    test('fossil rename a file', () => fossil_rename_a_file(sandbox)).timeout(
        15000
    );

    test('fossil rename a directory', () =>
        fossil_rename_a_directory(sandbox, executable)).timeout(20000);

    test('fossil open files', () =>
        fossil_open_files(sandbox, executable)).timeout(6000);

    test('fossil ignore', () => fossil_ignore(sandbox, executable)).timeout(
        8000
    );
    test('fossil revert change', () =>
        fossil_revert_change(sandbox, executable)).timeout(11000);

    test('fossil pull with autoUpdate on', () =>
        fossil_pull_with_autoUpdate_on(sandbox, executable)).timeout(5000);

    test('fossil pull with autoUpdate off', () =>
        fossil_pull_with_autoUpdate_off(sandbox, executable)).timeout(5000);

    test('fossil can amend commit message', () =>
        fossil_can_amend_commit_message(sandbox, executable)).timeout(5000);

    fossil_revert_suite(sandbox);

    test('fossil open resource', () => fossil_open_resource(sandbox)).timeout(
        12000
    );

    test('fossil add', () => fossil_add()).timeout(5000);

    test('fossil change branch to trunk', () =>
        fossil_change_branch_to_trunk(sandbox)).timeout(5000);
    test('fossil change branch to hash', () =>
        fossil_change_branch_to_hash(sandbox)).timeout(5000);

    test('fossil clean', () => fossil_clean(sandbox)).timeout(5000);

    fossil_stash_suite(sandbox);
    fossil_branch_suite(sandbox);
    fossil_commit_suite(sandbox);
    fossil_patch_suite(sandbox);
    fossil_utilities_suite(sandbox);
    fossil_merge_suite(sandbox);
    fossil_tag_suite(sandbox);
    fossil_stage_suite(sandbox);

    afterEach(() => {
        sandbox.restore();
    });
});
