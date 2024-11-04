/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ben Crowl. All rights reserved.
 *  Original Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as fs from 'fs/promises';
import { appendFileSync, existsSync, writeFileSync } from 'fs';
import { groupBy } from './util';
import { workspace, window, Uri } from 'vscode';
import { throttle } from './decorators';
import {
    FossilExecutable,
    FossilSpawnOptions,
    FossilArgs,
    ExecResult,
    Reason,
} from './fossilExecutable';
import { NewBranchOptions } from './interaction';
import { FossilCWD } from './fossilExecutable';

export type Distinct<T, DistinctName extends string> = T & {
    __TYPE__: DistinctName;
};
/** path to .fossil */
export type FossilPath = Distinct<string, 'path to .fossil'>;
/** local repository root */
export type FossilRoot = Distinct<string, 'local repository root'>;
export type RelativePath = Distinct<string, 'path relative to `FossilRoot`'>;
/** path that came from  `showOpenDialog` or `showSaveDialog`*/
export type UserPath = Distinct<string, 'user path'>;
/** path from `SourceControlResourceState.resourceUri.fsPath` */
export type ResourcePath = Distinct<string, 'resourceUri.fsPath'>;
export type AnyPath = RelativePath | ResourcePath | UserPath;

/** URI for the close
 *
 * * http[s]://[userid[:password]@]host[:port][/path]
 * * ssh://[userid@]host[:port]/path/to/repo.fossil[?fossil=path/fossil.exe]
 * * [file://]path/to/repo.fossil
 */
export type FossilURI = Distinct<Uri, 'Fossil URI'>;
/** Name shown by `fossil remote ls` command */
export type FossilRemoteName = Distinct<string, 'Fossil Remote Name'>;
/** https://fossil-scm.org/home/doc/trunk/www/checkin_names.wiki */
export type FossilBranch = Distinct<string, 'Fossil Branch Name'>;
/** https://fossil-scm.org/home/doc/trunk/www/checkin_names.wiki#special */
export type FossilSpecialTags = 'current' | 'parent' | 'tip';
export type FossilTag = Distinct<string, 'Fossil Tag Name'> | 'closed';
export type FossilHash = Distinct<string, 'Fossil SHA Hash'>;
export type FossilCheckin =
    | FossilBranch
    | FossilTag
    | FossilHash
    | FossilSpecialTags;
/** Stdout of `fossil status` command */
export type StatusString = Distinct<string, 'fossil status stdout'>;
/** Command (i.e 'update', 'merge', ) returned by `fossil undo --dry-run` */
export type FossilUndoCommand = Distinct<string, 'Undo Command'>;
/** Any commit message */
export type FossilCommitMessage = Distinct<string, 'Commit Message'>;
export const enum MergeAction {
    Merge,
    Integrate,
    Cherrypick,
}
export type FossilUsername = Distinct<string, 'fossil username'>;
export type FossilPassword = Distinct<string, 'fossil password'>;
export type StashID = Distinct<number, 'stash id'>;

export interface TimelineOptions extends LogEntryOptions {
    /** Output items affecting filePath only */
    readonly filePath?: RelativePath;
    /**
     * If `limit` is positive, output the first N entries. If
     * N is negative, output the first -N lines. If `limit` is
     * zero, no limit.  Default is -20 meaning 20 lines.
     */
    readonly limit: number;
    /** Output the list of files changed by each commit */
    readonly verbose?: boolean;
}

interface LogEntryOptions {
    readonly checkin?: FossilCheckin;
}

export const enum ResourceStatus {
    MODIFIED,
    ADDED,
    DELETED,
    EXTRA,
    MISSING,
    RENAMED,
    CONFLICT,
}

export interface FileStatus {
    readonly status: ResourceStatus;
    readonly klass: FossilClass;
    readonly path: string;
    // `rename` is a valid field since fossil 2.19
    // field should contain the new path and `path` must contain original path
    readonly rename?: string;
}

// parsed `fossil status ...` output
export interface FossilStatus {
    readonly statuses: FileStatus[];
    readonly isMerge: boolean;
    readonly info: Map<string, string>;
    readonly tags: string[]; // not FossilTag for a reason
    readonly checkout: { checkin: FossilCheckin; date: string };
}

export interface BranchDetails {
    readonly name: FossilBranch;
    readonly isCurrent: boolean;
    readonly isPrivate: boolean;
}

export interface FossilRemote {
    readonly name: FossilRemoteName;
    readonly uri: FossilURI;
}

export interface StashItem {
    readonly stashId: StashID;
    readonly hash: string;
    readonly date: Date;
    readonly comment: FossilCommitMessage;
}

export interface Revision {
    readonly hash: FossilHash;
}

export interface Commit extends Revision {
    readonly branch: FossilBranch;
    readonly message: FossilCommitMessage;
    readonly author: FossilUsername;
    readonly date: Date;
}

export interface CommitDetails extends Commit {
    files: FileStatus[];
}

export type Praise = [FossilHash, string, FossilUsername];

const classes = {
    EDITED: ResourceStatus.MODIFIED,
    EXECUTABLE: ResourceStatus.MODIFIED,
    UNEXEC: ResourceStatus.MODIFIED,
    SYMLINK: ResourceStatus.MODIFIED,
    UNLINK: ResourceStatus.MODIFIED,
    UPDATED_BY_INTEGRATE: ResourceStatus.MODIFIED,
    UPDATED_BY_MERGE: ResourceStatus.MODIFIED,
    ADDED_BY_INTEGRATE: ResourceStatus.ADDED,
    ADDED_BY_MERGE: ResourceStatus.ADDED,
    ADDED: ResourceStatus.ADDED,
    DELETED: ResourceStatus.DELETED,
    NOT_A_FILE: ResourceStatus.MISSING,
    MISSING: ResourceStatus.MISSING,
    CONFLICT: ResourceStatus.CONFLICT,
    RENAMED: ResourceStatus.RENAMED,
    EXTRA: ResourceStatus.EXTRA,
} as const;
export type FossilClass = keyof typeof classes;

function toStatus(klass: FossilClass, value: string): FileStatus {
    const status = classes[klass];
    // fossil did't have "->" before 2.19
    const idx = value.indexOf('->');
    if (idx != -1 || klass === 'RENAMED') {
        const [from_path, to_path] = value.split('  ->  ');
        return {
            klass,
            status,
            path: from_path as RelativePath,
            rename: to_path ?? from_path,
        };
    } else {
        return { klass, status, path: value as RelativePath };
    }
}

export type ConfigKey =
    | 'project-name'
    | 'short-project-name'
    | 'project-description'
    | 'last-git-export-repo';

export class OpenedRepository {
    private constructor(
        private readonly executable: FossilExecutable,
        public readonly root: FossilRoot
    ) {}

    static async tryOpen(
        executable: FossilExecutable,
        anypath: string
    ): Promise<OpenedRepository | undefined> {
        const isFile = (await fs.stat(anypath)).isFile();
        const cwd = (isFile ? path.dirname(anypath) : anypath) as FossilCWD;
        const result = await executable.exec(
            cwd,
            ['info'],
            `getting root for '${anypath}'` as Reason
        );
        const root = result.stdout.match(/local-root:\s*(.+)\/\s/);
        if (root) {
            return new OpenedRepository(executable, root[1] as FossilRoot);
        }
        return;
    }

    async exec(
        args: FossilArgs,
        reason?: Reason,
        options: Omit<FossilSpawnOptions, 'cwd'> = {} as const
    ): Promise<ExecResult> {
        return this.executable.exec(this.root, args, reason, options);
    }

    async add(paths?: RelativePath[]): Promise<void> {
        await this.exec(['add', ...(paths || [])]);
    }

    async ls(paths: string[]): Promise<string[]> {
        const result = await this.exec(['ls', ...paths]);
        return result.stdout.split('\n').filter(Boolean);
    }

    async cat(
        relativePath: RelativePath,
        checkin: FossilCheckin
    ): Promise<Buffer | undefined> {
        return this.executable.cat(this.root, [
            'cat',
            relativePath,
            ...(checkin ? ['-r', checkin] : []),
        ]);
    }

    /**
     * @returns: close result. For example `there are unsaved changes
     *           in the current checkout` in case of an error or an empty
     *           string on success
     */
    async close(): Promise<string> {
        const result = await this.exec(['close']);
        return (result.stdout + result.stderr).trim();
    }

    async update(checkin?: FossilCheckin): Promise<void> {
        await this.exec(['update', ...(checkin ? [checkin] : [])]);
    }

    async commit(
        message: FossilCommitMessage,
        fileList: RelativePath[],
        user: FossilUsername,
        newBranch: NewBranchOptions | undefined
    ): Promise<ExecResult> {
        // always pass a message, otherwise fossil
        // internal editor will spawn
        return this.exec([
            'commit',
            ...(user.length ? ['--user-override', user] : []),
            ...(newBranch
                ? [
                      ...(newBranch.branch
                          ? ['--branch', newBranch.branch]
                          : []),
                      ...(newBranch.color
                          ? ['--branchcolor', newBranch.color]
                          : []),
                      ...(newBranch.isPrivate ? ['--private'] : []),
                  ]
                : []),
            ...fileList,
            '-m',
            message,
        ]);
    }

    async getCurrentBranch(): Promise<FossilBranch | undefined> {
        const result = await this.exec(['branch', 'current']);
        if (result.exitCode) {
            return;
        }
        return result.stdout.trim() as FossilBranch;
    }

    async newBranch(newBranch: NewBranchOptions): Promise<ExecResult> {
        return await this.exec([
            'branch',
            'new',
            newBranch.branch,
            'current',
            ...(newBranch.isPrivate ? ['--private'] : []),
            ...(newBranch.color ? ['--bgcolor', newBranch.color] : []),
        ]);
    }

    async addTag(branch: FossilBranch, tag: FossilTag): Promise<void> {
        await this.exec(['tag', 'add', '--raw', tag, branch]);
    }

    async cancelTag(branch: FossilBranch, tag: FossilTag): Promise<void> {
        await this.exec(['tag', 'cancel', '--raw', tag, branch]);
    }

    async updateCommitMessage(
        checkin: FossilCheckin,
        commitMessage: FossilCommitMessage
    ): Promise<void> {
        await this.exec(['amend', checkin, '--comment', commitMessage]);
    }

    async praise(path: string): Promise<Praise[]> {
        const diffPromise = this.exec(['diff', '--json', path]);
        const praiseRes = await this.exec(['praise', path]);
        if (praiseRes.exitCode) {
            return []; // error should be shown to the user already
        }
        const praises = praiseRes.stdout
            .split('\n')
            .map(line => line.split(/\s+|:/, 3) as Praise);
        praises.pop(); // empty last line
        const diffJSONraw = (await diffPromise).stdout;
        if (diffJSONraw.length > 2) {
            const diff = JSON.parse(diffJSONraw)[0]['diff'] as (
                | string
                | number
            )[];
            let lineNo = 0;
            for (let idx = 0; idx < diff.length; idx += 2) {
                switch (diff[idx]) {
                    case 1: // skip N
                        lineNo += diff[idx + 1] as number;
                        continue;
                    // case 2: // info
                    //     break;
                    case 3: // new
                        praises.splice(lineNo, 0, [
                            '' as FossilHash,
                            '',
                            'you' as FossilUsername,
                        ]);
                        break;
                    case 4: // remove
                        praises.splice(lineNo, 1);
                        break;
                    case 5: // change
                        praises[lineNo] = [
                            '' as FossilHash,
                            '',
                            'you' as FossilUsername,
                        ];
                        break;
                }
                ++lineNo;
            }
        }
        return praises;
    }

    async revert(paths: RelativePath[]): Promise<void> {
        const pathsByGroup = groupBy(paths, p => path.dirname(p));
        const groups = Object.keys(pathsByGroup).map(k => pathsByGroup[k]);
        const tasks = groups.map(
            paths => () => this.exec(['revert', ...paths])
        );

        for (const task of tasks) {
            await task();
        }
    }

    async forget(paths: RelativePath[]): Promise<void> {
        const pathsByGroup = groupBy(paths, p => path.dirname(p));
        const groups = Object.keys(pathsByGroup).map(k => pathsByGroup[k]);
        const tasks = groups.map(
            paths => () => this.exec(['forget', ...paths])
        );

        for (const task of tasks) {
            await task();
        }
    }

    async rename(
        oldPath: AnyPath,
        newPath: RelativePath | UserPath
    ): Promise<void> {
        await this.exec(['rename', oldPath, newPath]);
    }

    async clean(paths: string[]): Promise<void> {
        if (paths.length) {
            await this.exec(['clean', ...paths]);
        }
    }

    /**
     * this method differs from `clean` because cleaning empty
     * paths[] will cause damage
     */
    async cleanAll(): Promise<void> {
        await this.exec(['clean']);
    }

    async ignore(paths: RelativePath[]): Promise<void> {
        const path = '.fossil-settings/ignore-glob' as RelativePath;
        const ignorePath = this.root + '/' + path;
        if (existsSync(ignorePath)) {
            appendFileSync(ignorePath, paths.join('\n') + '\n');
        } else {
            await fs.mkdir(this.root + '/.fossil-settings/');
            writeFileSync(ignorePath, paths.join('\n') + '\n');
            this.add([path]);
        }
        const document = await workspace.openTextDocument(ignorePath);
        window.showTextDocument(document);
    }

    async undoOrRedo<DRY extends boolean>(
        command: 'undo' | 'redo',
        dryRun: DRY
    ): Promise<FossilUndoCommand | undefined | 'NoUndo'>;
    async undoOrRedo(
        command: 'undo' | 'redo',
        dryRun: boolean
    ): Promise<FossilUndoCommand | undefined | 'NoUndo'> {
        const result = await this.exec([
            command,
            ...(dryRun ? ['--dry-run'] : []),
        ]);
        if (result.exitCode == 0 && !dryRun) {
            return;
        }
        const match =
            /A(n un| re)do is available for the following command:\s+(.*)/.exec(
                result.stdout
            );

        if (!match) {
            const no_undo =
                /^nothing to undo/.test(result.stderr) || // non dry
                /^No undo or redo is available/.test(result.stdout); // dry
            if (no_undo) {
                return 'NoUndo';
            }
            throw new Error(`Unexpected output ${result.stdout}`);
        }

        return match[2] as FossilUndoCommand;
    }

    async pull(name: FossilRemoteName): Promise<void> {
        await this.exec(['pull', name]);
    }

    async push(name: FossilRemoteName | undefined): Promise<void> {
        await this.exec(['push', ...(name ? [name] : [])]);
    }

    async merge(
        checkin: FossilCheckin,
        integrate: MergeAction
    ): Promise<ExecResult> {
        const extraArgs = (() => {
            switch (integrate) {
                case MergeAction.Cherrypick:
                    return ['--cherrypick'];
                case MergeAction.Integrate:
                    return ['--integrate'];
                default:
                    return [];
            }
        })();
        return this.exec(['merge', checkin, ...extraArgs]);
    }

    async patchCreate(path: string): Promise<void> {
        await this.exec(['patch', 'create', path]);
    }

    async patchApply(path: string): Promise<void> {
        await this.exec(['patch', 'apply', path]);
    }

    async stash(
        message: FossilCommitMessage,
        operation: 'save' | 'snapshot',
        paths: RelativePath[]
    ): Promise<void> {
        await this.exec(['stash', operation, '-m', message, ...paths]);
    }

    async stashList(): Promise<StashItem[]> {
        const res = await this.exec(['stash', 'list']);
        const out: StashItem[] = [];
        const lines = res.stdout.split('\n');
        for (let idx = 0; idx < lines.length; ++idx) {
            const line = lines[idx];
            if (line[5] == ':') {
                const match = line.match(/\s+(\d+):\s*\[(\w+)\] on (.*)/);
                if (!match) {
                    console.log('unexpected fossil stash output: ', line);
                } else {
                    let comment = '' as FossilCommitMessage;
                    if (lines[idx + 1][5] != ':') {
                        comment = lines[++idx].trim() as FossilCommitMessage;
                    }
                    out.push({
                        stashId: parseInt(match[1], 10) as StashID,
                        hash: match[2],
                        date: new Date(match[3] + '.000Z'),
                        comment,
                    });
                }
            }
        }
        return out;
    }

    async stashPop(): Promise<void> {
        await this.exec(['stash', 'pop']);
    }

    async stashApplyOrDrop(
        operation: 'apply' | 'drop',
        stashId: StashID
    ): Promise<void> {
        await this.exec(['stash', operation, stashId.toString()]);
    }

    /** Report the change status of files in the current checkout */
    @throttle
    async getStatus(reason: Reason): Promise<ExecResult> {
        return this.exec(['status', '--differ', '--merge'], reason);
    }

    parseStatusString(status: StatusString): FossilStatus {
        const statuses: FileStatus[] = [];
        const info = new Map<string, string>();

        for (const line of status.split('\n')) {
            const match = line.match(/^(\S+?):?\s+(.+)$/);
            if (!match) {
                continue;
            }
            const [, key, value] = match;
            if (key in classes) {
                statuses.push(toStatus(key as FossilClass, value));
            } else {
                info.set(key, value);
            }
        }
        const checkoutStr = info.get('checkout')!;
        const spaceIdx = checkoutStr.indexOf(' ');
        const checkout = {
            checkin: checkoutStr.slice(0, spaceIdx) as FossilCheckin,
            date: checkoutStr.slice(spaceIdx + 1),
        };
        const tags = info
            .get('tags')!
            .split(',')
            .map(t => t.trim());
        const isMerge =
            info.has('CHERRYPICK') ||
            info.has('BACKOUT') ||
            info.has('INTEGRATE') ||
            info.has('MERGED_WITH');
        return {
            statuses,
            isMerge,
            info,
            checkout,
            tags,
        };
    }

    async getLogEntries({
        checkin,
        filePath,
        limit,
        verbose,
    }: TimelineOptions): Promise<Commit[] | CommitDetails[]> {
        const result = await this.exec([
            'timeline',
            ...(checkin ? ['before', checkin] : []),
            ...(limit ? ['-n', `${limit}`] : []),
            ...(filePath ? ['-p', filePath] : []),
            ...(verbose ? ['--verbose'] : []),
            '--type',
            'ci',
            '--format',
            '%H+++%d+++%b+++%a+++%c',
        ]);

        const logEntries: Commit[] | CommitDetails[] = [];
        let lastFiles: CommitDetails['files'] = [];
        for (const line of result.stdout.split('\n')) {
            if (verbose && line.startsWith('   ')) {
                const [, key, value] = line.match(/^\s*(\S+?)\s+(.+)$/) || [];
                if (key in classes) {
                    lastFiles.push(toStatus(key as FossilClass, value));
                }
            }
            const parts = line.split('+++', 5);
            if (parts.length == 5) {
                const [hash, date, branch, author, message] = parts as [
                    FossilHash,
                    string,
                    FossilBranch,
                    FossilUsername,
                    FossilCommitMessage
                ];
                const commit: Commit = {
                    hash,
                    branch,
                    message,
                    author,
                    date: new Date(date + '.000Z'),
                };
                if (verbose) {
                    lastFiles = (commit as CommitDetails).files = [];
                }
                logEntries.push(commit as CommitDetails);
            }
        }
        return logEntries;
    }

    async getInfo(
        checkin: FossilCheckin,
        field: 'parent' | 'hash'
    ): Promise<FossilHash> {
        const info = await this.exec(['info', checkin]);
        const parent = info.stdout.match(
            new RegExp(`^${field}:\\s+(\\w+)`, 'm')
        );
        if (parent) {
            return parent[1] as FossilHash;
        }
        throw new Error(`fossil checkin '${checkin}' has no ${field}`);
    }

    /**
     * experimental method to get basic repository configuration
     */
    async config<T extends ConfigKey>(keys: T[]): Promise<Map<T, string>> {
        const result = await this.exec(
            ['sqlite', '--readonly'],
            'reading configuration for github' as Reason,
            {
                stdin_data:
                    '.mode json\n' +
                    'select name, value ' +
                    'from repository.config ' +
                    'where name in ' +
                    "('" +
                    keys.join("', '") +
                    "');",
            }
        );
        // sqlite return empty string when there are no rows
        const rows: { name: T; value: string }[] =
            result.stdout.length > 9 ? JSON.parse(result.stdout) : [];
        return new Map(rows.map(row => [row['name'], row['value']]));
    }
    async gitExport(): Promise<void> {
        await this.exec(['git', 'export']);
    }

    async info(checkin: FossilCheckin): Promise<{ [key: string]: string }> {
        const info = await this.exec([
            'info',
            checkin,
            '--comment-format',
            '-wordbreak',
        ]);
        const ret: { [key: string]: string } = {};
        let key: string | undefined;
        const kw = new RegExp(`^(\\w+):\\s+(.*)$`, 'm');
        for (const line of info.stdout.split('\n')) {
            if (line.length < 14) {
                continue;
            }
            if (line[0] != ' ') {
                const match = line.match(kw);
                if (match) {
                    key = match[1];
                    ret[key] = match[2];
                }
            } else {
                ret[key!] += '\n' + line.slice(14);
            }
        }
        return ret;
    }

    async getTags(): Promise<FossilTag[]> {
        const tagsResult = await this.exec(['tag', 'list']);
        // see comment from `getBranches`
        const tags = tagsResult.stdout.match(/^(.+)$/gm) as FossilTag[];
        return tags;
    }

    async getBranches(opts: { closed?: true } = {}): Promise<BranchDetails[]> {
        const branchesResult = await this.exec([
            'branch',
            'ls',
            '-t',
            ...(opts.closed ? ['-c'] : []),
        ]);
        const branches = Array.from(
            branchesResult.stdout.matchAll(
                // Fossil branch names can have spaces and all other characters.
                // Technically, it's easy to create a branch/tag
                // with a new line and mess everything here, the only hope
                // is that we are all adults here
                /^(?<isPrivate>[# ])(?<isCurrent>[* ])\s(?<name>.+)$/gm
            )
        ).map(match => {
            const groups = match.groups!;
            return {
                name: groups.name as FossilBranch,
                isCurrent: groups.isCurrent == '*',
                isPrivate: groups.isPrivate == '#',
            };
        });
        return branches;
    }

    async getRemotes(): Promise<FossilRemote[]> {
        const pathsResult = await this.exec(['remote', 'list']);
        return [...pathsResult.stdout.matchAll(/^(.+?)\s+(\S+)$/gm)].map(
            match => {
                const [, name, uri] = match;
                return {
                    name,
                    uri: Uri.parse(uri),
                } as FossilRemote;
            }
        );
    }
}
