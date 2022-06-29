import { before, afterEach, beforeEach } from 'mocha';
import { window, Uri } from 'vscode';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as fs from 'fs';
import { Fossil } from '../../fossilBase';
import { findFossil } from '../../main';
import {
    status_merge_integrate_is_visible_in_source_control_panel,
    status_missing_is_visible_in_source_control_panel,
    status_rename_is_visible_in_source_control_panel,
} from './test_status';
import { fossil_close } from './test_commands';
import { fossilInit, fossilOpen } from './common';

async function createFossil(): Promise<Fossil> {
    const outputChannel = window.createOutputChannel('Fossil.Test');
    const info = await findFossil('', outputChannel);
    const fossil = new Fossil({
        fossilPath: info.path,
        version: info.version,
        enableInstrumentation: true,
        outputChannel: outputChannel,
    });
    return fossil;
}

suite('Fossil', () => {
    const sandbox = sinon.createSandbox();
    let fossil: Fossil;
    before(async () => {
        fossil = await createFossil();
    });
    beforeEach(async () => {
        if (!vscode.workspace.workspaceFolders) {
            throw new Error('Expected opened workspace. Probably setup issue.');
        }
        const roorPath = vscode.workspace.workspaceFolders[0].uri;
        const entities = await fs.promises.readdir(roorPath.fsPath);
        await Promise.all(
            entities.map(name =>
                fs.promises.unlink(Uri.joinPath(roorPath, name).fsPath)
            )
        );
    });

    afterEach(() => {
        sandbox.restore();
    });

    test('fossil.init', async () => {
        await fossilInit(sandbox);
    });

    test('fossil.open', async () => {
        await fossilInit(sandbox);
        await fossilOpen(sandbox, fossil);
    });

    test('fossil.close', () => fossil_close(sandbox, fossil));

    test('fossil missing is visible in Source Control panel', async () =>
        status_missing_is_visible_in_source_control_panel(
            sandbox,
            fossil
        )).timeout(5000);

    test('fossil rename is visible in Source Control panel', () =>
        status_rename_is_visible_in_source_control_panel(
            sandbox,
            fossil
        )).timeout(15000);

    test('fossil integrate is visible in Source Control panel', () =>
        status_merge_integrate_is_visible_in_source_control_panel(
            sandbox,
            fossil
        )).timeout(10000);
});
