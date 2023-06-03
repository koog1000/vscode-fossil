import { before, afterEach, Suite } from 'mocha';
import * as sinon from 'sinon';
import {
    fossil_branch_suite,
    fossil_change_branch_to_hash,
    fossil_change_branch_to_trunk,
    fossil_commit_suite,
    fossil_merge_suite,
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
} from './test_commands';
import {
    fossil_can_amend_commit_message,
    fossil_file_log_can_diff_files,
} from './test_log';
import { cleanRoot, fossilInit, fossilOpen } from './common';
import { utilitiesSuite } from './utilitiesSuite';
import { resourceActionsSuite } from './resourceActionsSuite';

suite('Fossil.OpenedRepo', function (this: Suite) {
    const sandbox = sinon.createSandbox();
    this.ctx.sandbox = sandbox;
    before(async function () {
        this.timeout(5555);
        await cleanRoot();
        await fossilInit(sandbox);
        await fossilOpen(sandbox);
    });

    suite('Utilities', utilitiesSuite);

    suite('Update', function () {
        test('fossil pull with autoUpdate on', () =>
            fossil_pull_with_autoUpdate_on(sandbox)).timeout(5000);
        test('fossil pull with autoUpdate off', () =>
            fossil_pull_with_autoUpdate_off(sandbox)).timeout(5000);
        test('fossil change branch to trunk', () =>
            fossil_change_branch_to_trunk(sandbox)).timeout(5000);
        test('fossil change branch to hash', () =>
            fossil_change_branch_to_hash(sandbox)).timeout(5000);
    });

    suite('Resource Actions', resourceActionsSuite);

    suite('Log', function () {
        test('fossil file log can differ files', () =>
            fossil_file_log_can_diff_files(sandbox)).timeout(10000);
        test('fossil can amend commit message', () =>
            fossil_can_amend_commit_message(sandbox)).timeout(5000);
    });

    test('fossil revert change', () => fossil_revert_change()).timeout(11000);

    fossil_revert_suite(sandbox);
    fossil_stash_suite(sandbox);
    fossil_branch_suite(sandbox);
    fossil_commit_suite(sandbox);
    fossil_patch_suite(sandbox);
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
