import { before, afterEach, Suite } from 'mocha';
import * as sinon from 'sinon';
import {
    TagSuite,
    StatusSuite,
    CleanSuite,
    FileSystemSuite,
    DiffSuite,
} from './commandSuites';
import { MergeSuite } from './mergeSuite';
import { cleanRoot, fossilInit, fossilOpen } from './common';
import { utilitiesSuite } from './utilitiesSuite';
import { resourceActionsSuite } from './resourceActionsSuite';
import { timelineSuite } from './timelineSuite';
import { CommitSuite } from './commitSuite';
import { QualityOfLifeSuite as QualityOfLifeSuite } from './qualityOfLifeSuite';
import { PatchSuite, StageSuite, StashSuite, UpdateSuite } from './stateSuite';
import { RenameSuite } from './renameSuite';
import { BranchSuite } from './branchSuite';
import { RevertSuite } from './revertSuite';
import { GitExportSuite } from './gitExportSuite';
import { StatusBarSuite } from './statusBarSuite';
import { workspace } from 'vscode';

suite('Fossil.OpenedRepo', function (this: Suite) {
    this.ctx.sandbox = sinon.createSandbox();
    this.ctx.workspaceUri = workspace.workspaceFolders![0].uri;

    before(async () => {
        this.timeout(5555);
        await cleanRoot();
        await fossilInit(this.ctx.sandbox);
        await fossilOpen(this.ctx.sandbox);
    });

    suite('Utilities', utilitiesSuite);
    suite('Update', UpdateSuite);
    suite('Status Bar', StatusBarSuite);
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
    suite('FileSystem', FileSystemSuite);
    suite('Diff', DiffSuite);
    suite('Quality of Life', QualityOfLifeSuite);
    suite('Git Export', GitExportSuite);

    afterEach(() => {
        this.ctx.sandbox.restore();
    });
});
