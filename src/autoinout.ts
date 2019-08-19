/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ben Crowl. All rights reserved.
 *  Original Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { workspace, Disposable } from 'vscode';
import { FossilErrorCodes, FossilError } from "./fossilBase";
// import { Model} from "./model";
import { throttle } from './decorators';
import typedConfig from "./config";
import { Repository, Operation, /*Operations*/ } from './repository';

export const enum AutoInOutStatuses {
    Disabled,
    Enabled,
    Error
}

export interface AutoInOutState {
    readonly status: AutoInOutStatuses;
    readonly nextCheckTime?: Date;
    readonly error?: string;
}

const STARTUP_DELAY = 3 * 1000 /* three seconds */;
const OPS_AFFECTING_IN_OUT = Operation.Commit | Operation.RevertFiles | Operation.Update | Operation.Push | Operation.Pull;
const opAffectsInOut = (op: Operation): boolean => (OPS_AFFECTING_IN_OUT & op) > 0;

export class AutoIncomingOutgoing {

    private disposables: Disposable[] = [];
    private timer: NodeJS.Timer | undefined;

    constructor(private repository: Repository) {
        workspace.onDidChangeConfiguration(this.onConfiguration, this, this.disposables);
        this.repository.onDidRunOperation(this.onDidRunOperation, this, this.disposables);
        this.onConfiguration();
    }

    private onConfiguration(): void {
        if (typedConfig.autoInOut) {
            this.repository.changeAutoInoutState({ status: AutoInOutStatuses.Enabled })
            this.enable();
        }
        else {
            this.repository.changeAutoInoutState({ status: AutoInOutStatuses.Disabled })
            this.disable();
        }
    }

    enable(): void {
        if (this.enabled) {
            return;
        }

        setTimeout(() => this.refresh(), STARTUP_DELAY); // delay to let 'status' run first
        this.timer = setInterval(() => this.refresh(), typedConfig.autoInOutIntervalMillis);
    }

    disable(): void {
        if (!this.enabled) {
            return;
        }

        clearInterval(this.timer!);
        this.timer = undefined;
    }

    get enabled(): boolean { return this.timer !== undefined; }

    private onDidRunOperation(op: Operation): void {
        if (!this.enabled || !opAffectsInOut(op)) {
            return;
        }

        const pushPullBranchName = this.repository.pushPullBranchName;
        switch (op) {
            case Operation.Push:
                const path = this.repository.lastPushPath;
                if (!path || path === "default" || path === "default-push") {
                    const delta = -this.repository.syncCounts.outgoing;
                    this.repository.countOutgoingAfterDelay(delta);
                }
                break;

            case Operation.Pull:
                const delta = -this.repository.syncCounts.incoming;
                this.repository.countIncomingAfterDelay(delta);
                break;

            case Operation.Commit:
            case Operation.RevertFiles:
                const currentBranch = this.repository.currentBranch;
                const affectsInOut =
                    pushPullBranchName === undefined // all branches
                    || currentBranch && pushPullBranchName === currentBranch.name;

                if (affectsInOut) {
                    const delta = (op === Operation.Commit) ? +1 : -1;
                    this.repository.countOutgoingAfterDelay(delta);
                }
                break;

            case Operation.Update:
                if (pushPullBranchName && pushPullBranchName !== "default") { // i.e. "current" setting
                    const incoming = -this.repository.syncCounts.incoming;
                    const outgoing = -this.repository.syncCounts.outgoing;
                    this.repository.countIncomingOutgoingAfterDelay({ incoming, outgoing })
                }

            default:
            // no-op
        }
    }

    @throttle
    private async refresh(): Promise<void> {
        const nextCheckTime = new Date(Date.now() + typedConfig.autoInOutIntervalMillis);
        this.repository.changeAutoInoutState({ nextCheckTime });

        try {
            await this.repository.countIncomingOutgoingAfterDelay();
        }
        catch (err) {
            if (err instanceof FossilError && (
                err.fossilErrorCode === FossilErrorCodes.AuthenticationFailed ||
                err.fossilErrorCode === FossilErrorCodes.RepositoryIsUnrelated ||
                err.fossilErrorCode === FossilErrorCodes.RepositoryDefaultNotFound)) {
                this.disable();
            }
        }
    }

    dispose(): void {
        this.disable();
        this.disposables.forEach(d => d.dispose());
    }
}