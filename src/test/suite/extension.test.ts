import { before, afterEach, Suite } from 'mocha';
import * as sinon from 'sinon';
import {
    fossil_branch_suite,
    fossil_change_branch_to_hash,
    fossil_change_branch_to_trunk,
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
import { cleanRoot, fossilInit, fossilOpen } from './common';
import { utilitiesSuite } from './utilitiesSuite';
import { resourceActionsSuite } from './resourceActionsSuite';
import { timelineSuite } from './timelineSuite';
import { CommitSuite } from './commitSuite';
import { QualityOfLifeSuite as QualityOfLifeSuite } from './qualityOfLifeSuite';

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

    suite('Timeline', timelineSuite);

    test('fossil revert change', () => fossil_revert_change()).timeout(11000);

    fossil_revert_suite(sandbox);
    fossil_stash_suite();
    fossil_branch_suite(sandbox);
    suite('Commit', CommitSuite);
    fossil_patch_suite(sandbox);
    fossil_merge_suite(sandbox);
    fossil_tag_suite(sandbox);
    fossil_status_suite();
    fossil_stage_suite(sandbox);
    fossil_rename_suite(sandbox);
    fossil_clean_suite(sandbox);
    suite('Quality of Life', QualityOfLifeSuite);

    afterEach(() => {
        sandbox.restore();
    });
});
