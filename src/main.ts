/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ben Crowl. All rights reserved.
 *  Original Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// based on https://github.com/Microsoft/vscode/commit/41f0ff15d7327da30fdae73aa04ca570ce34fa0a

import { ExtensionContext, window, Disposable, commands } from 'vscode';
import { Fossil } from './fossilExecutable';
import { Model } from './model';
import { CommandCenter } from './commands';
import { FossilContentProvider } from './contentProvider';
import * as nls from 'vscode-nls';
import typedConfig from './config';
import { findFossil, FossilInfo } from './fossilFinder';

const localize = nls.loadMessageBundle();

async function init(
    context: ExtensionContext,
    disposables: Disposable[]
): Promise<Model | undefined> {
    // const { name, version, aiKey } = require(context.asAbsolutePath('./package.json')) as { name: string, version: string, aiKey: string };

    const outputChannel = window.createOutputChannel('Fossil');
    disposables.push(outputChannel);

    const enabled = typedConfig.enabled;
    const pathHint = typedConfig.path;
    const info: FossilInfo = await findFossil(pathHint, outputChannel);
    const fossil = new Fossil({
        fossilPath: info.path,
        version: info.version,
        outputChannel: outputChannel,
    });
    const model = new Model(fossil);
    disposables.push(model);

    const onRepository = () =>
        commands.executeCommand(
            'setContext',
            'fossilOpenRepositoryCount',
            model.repositories.length
        );
    model.onDidOpenRepository(onRepository, null, disposables);
    model.onDidCloseRepository(onRepository, null, disposables);
    onRepository();

    if (!enabled) {
        const commandCenter = new CommandCenter(
            fossil,
            model,
            outputChannel,
            context
        );
        disposables.push(commandCenter);
        return;
    }

    outputChannel.appendLine(
        localize(
            'using fossil',
            'Using fossil {0} from {1}',
            info.version.join('.'),
            info.path
        )
    );
    fossil.onOutput(str => outputChannel.append(str), null, disposables);

    disposables.push(
        new CommandCenter(fossil, model, outputChannel, context),
        new FossilContentProvider(model)
    );
    return model;
}

export async function activate(
    context: ExtensionContext
): Promise<void | Model> {
    const disposables: Disposable[] = [];
    context.subscriptions.push(
        new Disposable(() => Disposable.from(...disposables).dispose())
    );

    return init(context, disposables).catch(err => console.error(err));
}
