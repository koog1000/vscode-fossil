/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Arseniy Terekhin. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Command, SourceControl } from 'vscode';
import { Repository } from './repository';
import { ageFromNow, Old } from './humanise';
import { localize } from './main';
import { ExecResult } from './fossilExecutable';

/**
 * A bar with 'sync' icon;
 * - should run `fossil up` command for specific repository when clicked [ok]
 * - the tooltip should show 'changes' that are shown when running `fossil up --dry-run`
 * - should show number of remote changes (if != 0)
 * - should be animated when sync/update is running
 * - sync should be rescheduled after `sync` or `update` commands
 * - handle case when there's no sync URL
 */
class SyncBar {
    private icon: 'sync' | 'warning' = 'sync'; // 'sync-ignored' is nice, but not intuitive
    private text = '';
    private syncMessage: `${string}\n` | '' = '';
    /**
     * match for /changes:\s*(string)/
     * like `17 files modified.` or ` None. Already up-to-date`
     */
    private changes: string = ''; //
    private nextSyncTime: Date | undefined; // undefined = no auto syncing

    constructor(private repository: Repository) {}

    public onChangesReady(updateResult: ExecResult) {
        if (!updateResult.exitCode) {
            const match = updateResult.stdout.match(/^changes:\s*((\d*).*)/m);
            this.changes = match?.[1] ?? 'unknown changes';
            this.text = match?.[2] ?? ''; // digits of nothing
        } else {
            this.changes = this.text = '';
        }
    }

    public onSyncReady(result: ExecResult) {
        this.icon = 'sync';
        if (!result.exitCode) {
            this.syncMessage = '';
        } else {
            if (/^Usage: /.test(result.stderr)) {
                // likely only local repo
                this.syncMessage = 'repository with no remote\n';
            } else {
                this.icon = 'warning';
                this.syncMessage = `Sync error: ${result.stderr}\n`;
            }
        }
    }

    public onSyncTimeUpdated(date: Date | undefined) {
        this.nextSyncTime = date;
    }

    public get command(): Command {
        const timeMessage = this.nextSyncTime
            ? `Next sync ${this.nextSyncTime.toTimeString().split(' ')[0]}`
            : `Auto sync disabled`;
        return {
            command: 'fossil.update',
            title: `$(${this.icon}) ${this.text}`.trim(),
            tooltip: `${timeMessage}\n${this.syncMessage}${this.changes}\nUpdate`,
            arguments: [this.repository satisfies Repository],
        };
    }
}

/**
 * Create `vscode.Command` that executes 'fossil.branchChange'
 * decorated with icon, branch name, and repository status
 * with branch details in the tooltip
 */
function branchCommand(repository: Repository): Command {
    const { currentBranch, fossilStatus } = repository;
    const icon = fossilStatus!.isMerge ? '$(git-merge)' : '$(git-branch)';
    const title =
        icon +
        ' ' +
        (currentBranch || 'unknown') +
        (repository.conflictGroup.resourceStates.length
            ? '!'
            : repository.workingGroup.resourceStates.length
            ? '+'
            : '');
    let checkoutAge = '';
    const d = new Date(fossilStatus!.checkout.date.replace(' UTC', '.000Z'));
    checkoutAge = ageFromNow(d, Old.EMPTY_STRING);

    return {
        command: 'fossil.branchChange',
        tooltip: localize(
            'branch change {0} {1}{2} {3}',
            '{0}\n{1}{2}\nTags:\n • {3}\nChange Branch...',
            fossilStatus!.checkout.checkin,
            fossilStatus!.checkout.date,
            checkoutAge && ` (${checkoutAge})`,
            fossilStatus!.tags.join('\n • ')
        ),
        title,
        arguments: [repository satisfies Repository],
    };
}

export class StatusBarCommands {
    private readonly syncBar: SyncBar;

    constructor(
        private readonly repository: Repository,
        private readonly sourceControl: SourceControl
    ) {
        this.syncBar = new SyncBar(repository);
        this.update();
    }

    public onChangesReady(updateResult: ExecResult) {
        this.syncBar.onChangesReady(updateResult);
        this.update();
    }

    public onSyncTimeUpdated(date: Date | undefined) {
        this.syncBar.onSyncTimeUpdated(date);
        this.update();
    }

    public onSyncReady(syncResult: ExecResult) {
        this.syncBar.onSyncReady(syncResult);
        this.update();
    }

    /**
     * Should be called whenever commands text/actions/tooltips
     * are updated
     */
    public update(): void {
        let commands: Command[];
        if (this.repository.fossilStatus) {
            const update = branchCommand(this.repository);
            const sideEffects = this.repository.operations;
            const messages = [];
            for (const [, se] of sideEffects) {
                if (se.syncText) {
                    messages.push(se.syncText);
                }
            }
            messages.sort();
            const sync = messages.length
                ? {
                      title: '$(sync~spin)',
                      command: '',
                      tooltip: messages.join('\n'),
                  }
                : this.syncBar.command;

            commands = [update, sync];
        } else {
            // this class was just initialized, repository status is unknown
            commands = [
                {
                    command: '',
                    tooltip: localize(
                        'loading {0}',
                        'Loading {0}',
                        this.repository.root
                    ),
                    title: '$(sync~spin)',
                },
            ];
        }
        this.sourceControl.statusBarCommands = commands;
    }
}
