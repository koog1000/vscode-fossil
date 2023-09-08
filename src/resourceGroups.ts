import { FossilRoot, FileStatus, ResourceStatus } from './openedRepository';
import {
    Uri,
    SourceControlResourceGroup,
    SourceControl,
    Disposable,
} from 'vscode';
import * as path from 'path';
import { FossilResource } from './repository';

import { localize } from './main';

export interface IGroupStatusesParams {
    repositoryRoot: FossilRoot;
    statusGroups: IStatusGroups;
    fileStatuses: FileStatus[];
}

export interface IStatusGroups {
    conflict: FossilResourceGroup;
    staging: FossilResourceGroup;
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
        working: workingGroup,
        untracked: untrackedGroup,
    };
}

export interface IFossilResourceGroup extends SourceControlResourceGroup {
    resourceStates: FossilResource[];
}

export class FossilResourceGroup {
    private readonly _uriToResource: Map<string, FossilResource>;
    private readonly _vscode_group: IFossilResourceGroup;
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
    includesDir(uriStr: string): boolean {
        // important: `uriStr` should end with path.sep to work properly
        for (const key of this._uriToResource.keys()) {
            if (key.startsWith(uriStr)) {
                return true;
            }
        }
        return false;
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
        // existing resources must be updated
        // because resource status might change
        for (const res of resources) {
            this._uriToResource.delete(res.resourceUri.toString());
            res.resourceGroup = this;
        }
        const intersectionResources: FossilResource[] = [
            ...resources,
            ...this._uriToResource.values(),
        ];
        this.updateResources(intersectionResources);
    }

    except(resources_to_exclude: FossilResource[]): void {
        for (const res of resources_to_exclude) {
            this._uriToResource.delete(res.resourceUri.toString());
        }
        this.updateResources([...this._uriToResource.values()]);
    }
}

export function groupStatuses({
    repositoryRoot,
    statusGroups: { conflict, staging, working, untracked },
    fileStatuses,
}: IGroupStatusesParams): void {
    const workingDirectoryResources: FossilResource[] = [];
    const stagingResources: FossilResource[] = [];
    const conflictResources: FossilResource[] = [];
    const untrackedResources: FossilResource[] = [];

    const chooseResourcesAndGroup = (
        uriString: Uri,
        status: ResourceStatus
    ): [FossilResource[], FossilResourceGroup] => {
        if (status === ResourceStatus.EXTRA) {
            return [untrackedResources, untracked];
        }

        if (status === ResourceStatus.CONFLICT) {
            return [conflictResources, conflict];
        }
        return staging.includesUri(uriString)
            ? [stagingResources, staging]
            : [workingDirectoryResources, working];
    };

    const seenUriStrings: Map<string, boolean> = new Map();

    for (const raw of fileStatuses) {
        const uri = Uri.file(path.join(repositoryRoot, raw.path));
        const uriString = uri.toString();
        seenUriStrings.set(uriString, true);
        const renameUri = raw.rename
            ? Uri.file(path.join(repositoryRoot, raw.rename))
            : undefined;
        const [resources, group] = chooseResourcesAndGroup(uri, raw.status);
        resources.push(
            new FossilResource(group, uri, raw.status, raw.klass, renameUri)
        );
    }

    conflict.updateResources(conflictResources);
    staging.updateResources(stagingResources);
    working.updateResources(workingDirectoryResources);
    untracked.updateResources(untrackedResources);
}

export const isResourceGroup = (
    obj: FossilResource | SourceControlResourceGroup
): obj is SourceControlResourceGroup =>
    (<SourceControlResourceGroup>obj).resourceStates !== undefined;
