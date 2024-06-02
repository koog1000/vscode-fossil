/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ben Crowl. All rights reserved.
 *  Original Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// based on https://github.com/Microsoft/vscode/commit/41f0ff15d7327da30fdae73aa04ca570ce34fa0a

import { ExtensionContext, window, Disposable, commands, Uri } from 'vscode';
import { Model } from './model';
import { CommandCenter } from './commands';
import { FossilFileSystemProvider } from './fileSystemProvider';
import * as nls from 'vscode-nls';
import typedConfig from './config';
import { findFossil } from './fossilFinder';
import { FossilExecutable } from './fossilExecutable';

export const localize = nls.loadMessageBundle();

async function init(context: ExtensionContext): Promise<Model | undefined> {
    const disposables: Disposable[] = [];
    context.subscriptions.push(
        new Disposable(() => Disposable.from(...disposables).dispose())
    );

    const outputChannel = window.createOutputChannel('Fossil');
    disposables.push(outputChannel);

    const fossilHist = typedConfig.path;
    const fossilInfo = await findFossil(fossilHist, outputChannel.appendLine);
    const executable = new FossilExecutable(outputChannel);

    const model = new Model(executable, fossilHist);
    disposables.push(model);
    model.foundExecutable(fossilInfo);
    if (!fossilInfo && !typedConfig.ignoreMissingFossilWarning) {
        const download = localize('downloadFossil', 'Download Fossil');
        const neverShowAgain = localize('neverShowAgain', "Don't Show Again");
        const editPath = localize('editPath', 'Edit "fossil.path"');
        const choice = await window.showWarningMessage(
            localize(
                'notfound',
                "Fossil was not found. Install it or configure it using the 'fossil.path' setting."
            ),
            download,
            editPath,
            neverShowAgain
        );
        if (choice === download) {
            commands.executeCommand(
                'vscode.open',
                Uri.parse('https://www.fossil-scm.org/')
            );
        } else if (choice === editPath) {
            commands.executeCommand(
                'workbench.action.openSettings',
                'fossil.path'
            );
        } else if (choice === neverShowAgain) {
            await typedConfig.disableMissingFossilWarning();
        }
    }

    const onRepository = () =>
        commands.executeCommand(
            'setContext',
            'fossilOpenRepositoryCount',
            model.repositories.length
        );
    model.onDidOpenRepository(onRepository, null, disposables);
    model.onDidCloseRepository(onRepository, null, disposables);
    onRepository();

    disposables.push(
        new CommandCenter(executable, model, outputChannel, context),
        new FossilFileSystemProvider(model)
    );
    return model;
}

export async function activate(
    context: ExtensionContext
): Promise<void | Model> {
    return init(context).catch(err => console.error(err));
}
