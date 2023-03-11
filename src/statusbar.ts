/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ben Crowl. All rights reserved.
 *  Original Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, Command, EventEmitter, Event } from 'vscode';
import { anyEvent, dispose } from './util';
import { AutoInOutStatuses, AutoInOutState } from './autoinout';
import { Repository, Operation } from './repository';

import { localize } from './main';

const enum SyncStatus {
    None = 0,
    Pushing = 1,
    Pulling = 2,
}

class ScopeStatusBar {
    private _onDidChange = new EventEmitter<void>();
    get onDidChange(): Event<void> {
        return this._onDidChange.event;
    }
    private disposables: Disposable[] = [];

    constructor(private repository: Repository) {
        repository.onDidChange(
            this._onDidChange.fire,
            this._onDidChange,
            this.disposables
        );
    }

    get command(): Command | undefined {
        const { currentBranch, repoStatus } = this.repository;
        if (!currentBranch) {
            return undefined;
        }
        const icon = repoStatus?.isMerge ? '$(git-merge)' : '$(git-branch)';
        const title =
            icon +
            ' ' +
            currentBranch +
            (this.repository.workingGroup.resourceStates.length ? '+' : '') +
            (this.repository.mergeGroup.resourceStates.length ? '!' : '');

        return {
            command: 'fossil.branchChange',
            tooltip: localize('branch change', 'Change Branch...'),
            title,
            arguments: [this.repository],
        };
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
    }
}

interface SyncStatusBarState {
    autoInOut: AutoInOutState;
    syncStatus: SyncStatus;
    nextCheckTime: Date;
}

class SyncStatusBar {
    private static StartState: SyncStatusBarState = {
        autoInOut: {
            status: AutoInOutStatuses.Disabled,
            error: '',
        },
        nextCheckTime: new Date(),
        syncStatus: SyncStatus.None,
    };

    private _onDidChange = new EventEmitter<void>();
    get onDidChange(): Event<void> {
        return this._onDidChange.event;
    }
    private disposables: Disposable[] = [];

    private _state: SyncStatusBarState = SyncStatusBar.StartState;
    private get state() {
        return this._state;
    }
    private set state(state: SyncStatusBarState) {
        this._state = state;
        this._onDidChange.fire();
    }

    constructor(private repository: Repository) {
        repository.onDidChange(this.onModelChange, this, this.disposables);
        repository.onDidChangeOperations(
            this.onOperationsChange,
            this,
            this.disposables
        );
        this._onDidChange.fire();
    }

    private getSyncStatus(): SyncStatus {
        if (this.repository.operations.has(Operation.Push)) {
            return SyncStatus.Pushing;
        }

        if (this.repository.operations.has(Operation.Pull)) {
            return SyncStatus.Pulling;
        }

        return SyncStatus.None;
    }

    private onOperationsChange(): void {
        this.state = {
            ...this.state,
            syncStatus: this.getSyncStatus(),
            autoInOut: this.repository.autoInOutState,
        };
    }

    private onModelChange(): void {
        this.state = {
            ...this.state,
            autoInOut: this.repository.autoInOutState,
        };
    }

    private describeAutoInOutStatus(): {
        icon: string;
        message?: string;
        status: AutoInOutStatuses;
    } {
        const { autoInOut } = this.state;
        switch (autoInOut.status) {
            case AutoInOutStatuses.Enabled:
                if (autoInOut.nextCheckTime) {
                    const time = autoInOut.nextCheckTime.toLocaleTimeString();
                    const message = localize(
                        'synced next check',
                        'Synced (next check {0})',
                        time
                    );

                    return {
                        icon: '$(sync)',
                        message,
                        status: AutoInOutStatuses.Enabled,
                    };
                } else {
                    return {
                        icon: '',
                        message: 'Enabled but no next sync time',
                        status: AutoInOutStatuses.Enabled,
                    };
                }

            case AutoInOutStatuses.Error:
                return {
                    icon: '$(stop)',
                    message: `${localize('remote error', 'Remote error')}: ${
                        autoInOut.error
                    }`,
                    status: AutoInOutStatuses.Error,
                };

            case AutoInOutStatuses.Disabled:
            default: {
                const message = localize('sync', 'Sync');
                return {
                    icon: '$(sync-ignored)',
                    message,
                    status: AutoInOutStatuses.Disabled,
                };
            }
        }
    }

    get command(): Command | undefined {
        const autoInOut = this.describeAutoInOutStatus();
        let icon = autoInOut.icon;
        let text = '';
        let command = 'fossil.pull'; // pull in autoupdate context performs an 'update'
        let tooltip = autoInOut.message;

        const { syncStatus } = this.state;
        if (syncStatus) {
            icon = '$(sync~spin)';
            text = '';
            command = '';
            tooltip = localize('syncing', 'Syncing changes...');
        }

        return {
            command,
            title: `${icon} ${text}`.trim(),
            tooltip,
            arguments: [this.repository],
        };
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
    }
}

export class StatusBarCommands {
    private readonly syncStatusBar: SyncStatusBar;
    private readonly scopeStatusBar: ScopeStatusBar;
    private readonly disposables: Disposable[] = [];

    constructor(repository: Repository) {
        this.syncStatusBar = new SyncStatusBar(repository);
        this.scopeStatusBar = new ScopeStatusBar(repository);
    }

    get onDidChange(): Event<void> {
        return anyEvent(
            this.syncStatusBar.onDidChange,
            this.scopeStatusBar.onDidChange
        );
    }

    get commands(): Command[] {
        const result: Command[] = [];

        const update = this.scopeStatusBar.command;

        if (update) {
            result.push(update);
        }

        const sync = this.syncStatusBar.command;

        if (sync) {
            result.push(sync);
        }

        return result;
    }

    dispose(): void {
        this.syncStatusBar.dispose();
        this.scopeStatusBar.dispose();
        dispose(this.disposables);
    }
}
