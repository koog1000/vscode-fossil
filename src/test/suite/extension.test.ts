import { before, afterEach, Suite } from 'mocha';
import * as sinon from 'sinon';
import {
    RevertSuite,
    BranchSuite,
    MergeSuite,
    TagSuite,
    RenameSuite,
    StatusSuite,
    CleanSuite,
} from './test_commands';
import { cleanRoot, fossilInit, fossilOpen } from './common';
import { utilitiesSuite } from './utilitiesSuite';
import { resourceActionsSuite } from './resourceActionsSuite';
import { timelineSuite } from './timelineSuite';
import { CommitSuite } from './commitSuite';
import { QualityOfLifeSuite as QualityOfLifeSuite } from './qualityOfLifeSuite';
import { PatchSuite, StageSuite, StashSuite, UpdateSuite } from './stateSuite';

suite('Fossil.OpenedRepo', function (this: Suite) {
    this.ctx.sandbox = sinon.createSandbox();
    before(async () => {
        this.timeout(5555);
        await cleanRoot();
        await fossilInit(this.ctx.sandbox);
        await fossilOpen(this.ctx.sandbox);
    });

    suite('Utilities', utilitiesSuite);
    suite('Update', UpdateSuite);
    suite('Resource Actions', resourceActionsSuite);
    suite('Timeline', timelineSuite);
    suite('Revert', RevertSuite);
    suite('Stash', StashSuite);
    suite('Branch', BranchSuite);
    suite('Commit', CommitSuite);
    suite('Patch', PatchSuite);
    suite('Merge', MergeSuite);
    suite('Tag', TagSuite);
    suite('Status', StatusSuite);
    suite('Stage', StageSuite);
    suite('Rename', RenameSuite);
    suite('Clean', CleanSuite);
    suite('Quality of Life', QualityOfLifeSuite);

    afterEach(() => {
        this.ctx.sandbox.restore();
    });
});
