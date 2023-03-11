import { FossilRoot, IFileStatus } from './openedRepository';
import {
    Uri,
    SourceControlResourceGroup,
    SourceControl,
    Disposable,
} from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { FossilResource, Status, MergeStatus } from './repository';

import { localize } from './main';

export interface IGroupStatusesParams {
    repositoryRoot: FossilRoot;
    statusGroups: IStatusGroups;
    fileStatuses: IFileStatus[];
    // repoStatus: IRepoStatus,
    resolveStatuses: IFileStatus[] | undefined;
}

export interface IStatusGroups {
    conflict: FossilResourceGroup;
    staging: FossilResourceGroup;
    merge: FossilResourceGroup;
    working: FossilResourceGroup;
    untracked: FossilResourceGroup;
}

export type FossilResourceId = keyof IStatusGroups;

export function createEmptyStatusGroups(scm: SourceControl): IStatusGroups {
    const conflictGroup = new FossilResourceGroup(
        scm,
        'conflict',
        localize('merge conflicts', 'Unresolved Conflicts')
    );
    const stagingGroup = new FossilResourceGroup(
        scm,
        'staging',
        localize('staged changes', 'Staged Changes')
    ) as FossilResourceGroup;
    const mergeGroup = new FossilResourceGroup(
        scm,
        'merge',
        localize('merged changes', 'Merged Changes')
    ) as FossilResourceGroup;
    const workingGroup = new FossilResourceGroup(
        scm,
        'working',
        localize('changes', 'Changes')
    ) as FossilResourceGroup;
    const untrackedGroup = new FossilResourceGroup(
        scm,
        'untracked',
        localize('untracked files', 'Untracked Files')
    ) as FossilResourceGroup;

    return {
        conflict: conflictGroup,
        staging: stagingGroup,
        merge: mergeGroup,
        working: workingGroup,
        untracked: untrackedGroup,
    };
}

export interface IFossilResourceGroup extends SourceControlResourceGroup {
    resourceStates: FossilResource[];
}

export class FossilResourceGroup {
    private _uriToResource: Map<string, FossilResource>;
    private _vscode_group: IFossilResourceGroup;
    get disposable(): Disposable {
        return this._vscode_group;
    }
    get resourceStates(): FossilResource[] {
        return this._vscode_group.resourceStates;
    }
    getResource(uri: Uri): FossilResource | undefined {
        return this._uriToResource.get(uri.toString());
    }
    includesUri(uri: Uri): boolean {
        return this._uriToResource.has(uri.toString());
    }

    constructor(
        sourceControl: SourceControl,
        id: FossilResourceId,
        label: string
    ) {
        this._uriToResource = new Map<string, FossilResource>();
        this._vscode_group = sourceControl.createResourceGroup(
            id,
            label
        ) as IFossilResourceGroup;
        this._vscode_group.hideWhenEmpty = true;
    }

    is(id: FossilResourceId): boolean {
        return this._vscode_group.id === id;
    }

    updateResources(resources: FossilResource[]): void {
        this._vscode_group.resourceStates = resources;
        this._uriToResource.clear();
        resources.forEach(resource =>
            this._uriToResource.set(resource.resourceUri.toString(), resource)
        );
    }

    intersect(resources: FossilResource[]): void {
        const newUniqueResources = resources.filter(
            resource =>
                !this._uriToResource.has(resource.resourceUri.toString())
        );
        const intersectionResources: FossilResource[] = [
            ...this.resourceStates,
            ...newUniqueResources,
        ];
        this.updateResources(intersectionResources);
    }

    except(resources_to_exclude: FossilResource[]): void {
        const uri_to_exclude = new Set<string>(
            resources_to_exclude.map(resource =>
                resource.resourceUri.toString()
            )
        );
        const newResources = this.resourceStates.filter(
            resource => !uri_to_exclude.has(resource.resourceUri.toString())
        );
        this.updateResources(newResources);
    }
}

export function groupStatuses({
    repositoryRoot,
    statusGroups: { conflict, staging, merge, working, untracked },
    fileStatuses,
    // repoStatus,
    resolveStatuses,
}: IGroupStatusesParams): void {
    const workingDirectoryResources: FossilResource[] = [];
    const stagingResources: FossilResource[] = [];
    const conflictResources: FossilResource[] = [];
    const mergeResources: FossilResource[] = [];
    const untrackedResources: FossilResource[] = [];

    const chooseResourcesAndGroup = (
        uriString: Uri,
        rawStatus: IFileStatus['status'],
        mergeStatus: MergeStatus,
        renamed: boolean
    ): [FossilResource[], FossilResourceGroup, Status] => {
        let status: Status;
        switch (rawStatus) {
            case 'M':
                status = Status.MODIFIED;
                break;
            case 'R':
                status = Status.DELETED;
                break;
            // case 'I':
            //     status = Status.IGNORED;
            //     break;
            case '?':
                status = Status.UNTRACKED;
                break;
            case '!':
                status = Status.MISSING;
                break;
            case 'A':
                status = renamed ? Status.RENAMED : Status.ADDED;
                break;
            case 'C':
                status = Status.CONFLICT;
                break;
            default:
                throw new Error('Unknown rawStatus: ' + rawStatus);
        }

        if (status === Status.UNTRACKED) {
            return [untrackedResources, untracked, status];
        }

        // if (repoStatus.isMerge) {
        //     if (mergeStatus === MergeStatus.UNRESOLVED) {
        //         return [conflictResources, conflict, status];
        //     }
        //     return [mergeResources, merge, status];
        // }
        if (status === Status.CONFLICT) {
            return [conflictResources, conflict, status];
        }
        const isStaged = staging.includesUri(uriString) ? true : false;
        const targetResources: FossilResource[] = isStaged
            ? stagingResources
            : workingDirectoryResources;
        const targetGroup: FossilResourceGroup = isStaged ? staging : working;
        return [targetResources, targetGroup, status];
    };

    const seenUriStrings: Map<string, boolean> = new Map();

    for (const raw of fileStatuses) {
        const uri = Uri.file(path.join(repositoryRoot, raw.path));
        const uriString = uri.toString();
        seenUriStrings.set(uriString, true);
        const renameUri = raw.rename
            ? Uri.file(path.join(repositoryRoot, raw.rename))
            : undefined;
        const resolveFile =
            resolveStatuses &&
            resolveStatuses.filter(res => res.path === raw.path)[0];
        const mergeStatus = resolveFile
            ? toMergeStatus(resolveFile.status)
            : MergeStatus.NONE;
        const [resources, group, status] = chooseResourcesAndGroup(
            uri,
            raw.status,
            mergeStatus,
            !!raw.rename
        );
        resources.push(
            new FossilResource(group, uri, status, mergeStatus, renameUri)
        );
    }

    // it is possible for a clean file to need resolved
    // e.g. when local changed and other deleted
    if (resolveStatuses) {
        for (const raw of resolveStatuses) {
            const uri = Uri.file(path.join(repositoryRoot, raw.path));
            const uriString = uri.toString();
            if (seenUriStrings.has(uriString)) {
                continue; // dealt with by the fileStatuses (this is the norm)
            }
            const mergeStatus = toMergeStatus(raw.status);
            const inferredStatus: IFileStatus['status'] = fs.existsSync(
                uri.fsPath
            )
                ? 'C'
                : 'R';
            const [resources, group, status] = chooseResourcesAndGroup(
                uri,
                inferredStatus,
                mergeStatus,
                !!raw.rename
            );
            resources.push(new FossilResource(group, uri, status, mergeStatus));
        }
    }
    conflict.updateResources(conflictResources);
    merge.updateResources(mergeResources);
    staging.updateResources(stagingResources);
    working.updateResources(workingDirectoryResources);
    untracked.updateResources(untrackedResources);
}

function toMergeStatus(status: string): MergeStatus {
    switch (status) {
        case 'R':
            return MergeStatus.RESOLVED;
        case 'U':
            return MergeStatus.UNRESOLVED;
        default:
            return MergeStatus.NONE;
    }
}

export const isResourceGroup = (obj: any): obj is SourceControlResourceGroup =>
    (<SourceControlResourceGroup>obj).resourceStates !== undefined;
