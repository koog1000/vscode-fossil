import { before, afterEach } from 'mocha';
import * as sinon from 'sinon';
import {
    fossil_add,
    fossil_branch_suite,
    fossil_change_branch_to_hash,
    fossil_change_branch_to_trunk,
    fossil_commit_suite,
    fossil_ignore,
    fossil_merge_suite,
    fossil_open_files,
    fossil_open_resource,
    fossil_patch_suite,
    fossil_pull_with_autoUpdate_off,
    fossil_pull_with_autoUpdate_on,
    fossil_clean_suite,
    fossil_rename_suite,
    fossil_revert_change,
    fossil_revert_suite,
    fossil_stage_suite,
    fossil_stash_suite,
    fossil_status_suite,
    fossil_tag_suite,
    fossil_utilities_suite,
    fossil_forget,
} from './test_commands';
import {
    fossil_can_amend_commit_message,
    fossil_file_log_can_diff_files,
} from './test_log';
import { cleanRoot, fossilInit, fossilOpen } from './common';
import {
    fossil_undo_and_redo_warning,
    fossil_undo_and_redo_working,
} from './test_undo_redo';

suite('Fossil.OpenedRepo', function () {
    const sandbox = sinon.createSandbox();
    before(async function () {
        this.timeout(5555);
        await cleanRoot();
        await fossilInit(sandbox);
        await fossilOpen(sandbox);
    });

    test('fossil undo and redo warning', () =>
        // this test requires just initialized state
        fossil_undo_and_redo_warning(sandbox)).timeout(5000);

    test('fossil file log can differ files', () =>
        fossil_file_log_can_diff_files(sandbox)).timeout(10000);

    test('fossil undo and redo working', () =>
        fossil_undo_and_redo_working(sandbox)).timeout(15000);

    test('fossil open files', () => fossil_open_files(sandbox)).timeout(6000);

    test('fossil ignore', () => fossil_ignore(sandbox)).timeout(8000);
    test('fossil revert change', () => fossil_revert_change()).timeout(11000);

    test('fossil pull with autoUpdate on', () =>
        fossil_pull_with_autoUpdate_on(sandbox)).timeout(5000);

    test('fossil pull with autoUpdate off', () =>
        fossil_pull_with_autoUpdate_off(sandbox)).timeout(5000);

    test('fossil can amend commit message', () =>
        fossil_can_amend_commit_message(sandbox)).timeout(5000);

    fossil_revert_suite(sandbox);

    test('fossil open resource', () => fossil_open_resource(sandbox)).timeout(
        12000
    );

    test('fossil add', () => fossil_add()).timeout(5000);
    test('fossil forget', () => fossil_forget(sandbox)).timeout(5000);

    test('fossil change branch to trunk', () =>
        fossil_change_branch_to_trunk(sandbox)).timeout(5000);
    test('fossil change branch to hash', () =>
        fossil_change_branch_to_hash(sandbox)).timeout(5000);

    fossil_stash_suite(sandbox);
    fossil_branch_suite(sandbox);
    fossil_commit_suite(sandbox);
    fossil_patch_suite(sandbox);
    fossil_utilities_suite(sandbox);
    fossil_merge_suite(sandbox);
    fossil_tag_suite(sandbox);
    fossil_status_suite();
    fossil_stage_suite(sandbox);
    fossil_rename_suite(sandbox);
    fossil_clean_suite(sandbox);

    afterEach(() => {
        sandbox.restore();
    });
});
