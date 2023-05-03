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
    FossilError,
    FossilSpawnOptions,
    IExecutionResult,
    FossilArgs,
    FossilStdOut,
    FossilStdErr,
} from './fossilExecutable';
import { NewBranchOptions } from './interaction';

export type Distinct<T, DistinctName> = T & { __TYPE__: DistinctName };
/** path to .fossil */
export type FossilPath = Distinct<string, 'path to .fossil'>;
/** local repository root */
export type FossilRoot = Distinct<string, 'local repository root'>;
export type RelativePath = Distinct<string, 'path relative to `FossilRoot`'>;
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
const FossilSpecialTagsList = ['current', 'parent', 'tip'] as const;
export type FossilSpecialTags = (typeof FossilSpecialTagsList)[number];
export type FossilTag = Distinct<string, 'Fossil Tag Name'> | 'closed';
export type FossilHash = Distinct<string, 'Fossil SHA Hash'>;
export type FossilCheckin =
    | FossilBranch
    | FossilTag
    | FossilHash
    | FossilSpecialTags;
/** Stdout of `fossil status` command */
export type StatusString = Distinct<string, 'fossil status stdout'>;
/** Command returned by `fossil undo --dry-run` */
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

export interface LogEntryOptions {
    readonly checkin?: FossilCheckin;
}

export interface PullOptions {
    //readonly branch?: FossilBranch;
    //readonly revs?: FossilCheckin[];
    readonly autoUpdate: boolean; // run an update after the pull?
}

export interface IMergeResult {
    readonly unresolvedCount: number;
}

export interface IRepoStatus {
    readonly isMerge: boolean;
    readonly parent?: FossilHash;
}

export interface IFileStatus {
    readonly status: 'M' | 'A' | 'R' | 'C' | '!' | '?';
    readonly path: string;
    // `rename` is a valid field since fossil 2.19
    // field should contain the new path and `path` must contain original path
    readonly rename?: string;
}

export interface BranchDetails {
    readonly name: FossilBranch;
    readonly isCurrent: boolean;
    readonly isPrivate: boolean;
}

export interface FossilRemote {
    readonly name: FossilRemoteName;
    readonly url: FossilURI;
}

export interface StashItem {
    readonly stashId: number;
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
    files: IFileStatus[];
}

export type Praise = [FossilHash, string, FossilUsername];

export class OpenedRepository {
    constructor(
        private readonly executable: FossilExecutable,
        public readonly root: FossilRoot
    ) {}

    async exec(
        args: FossilArgs,
        reason = '',
        options: Omit<FossilSpawnOptions, 'cwd'> = {}
    ): Promise<IExecutionResult> {
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
    ): Promise<FossilStdOut> {
        const result = await this.exec(
            ['cat', relativePath, ...(checkin ? ['-r', checkin] : [])],
            '',
            { logErrors: false }
        );
        return result.stdout;
    }

    /**
     * @returns: close result. For example `there are unsaved changes
     *           in the current checkout` in case of an error or an empty
     *           string on success
     */
    async close(): Promise<string> {
        try {
            const result = await this.exec(['close']);
            return result.stdout + result.stderr;
        } catch (err) {
            if (err instanceof FossilError && err.stderr) {
                return err.stdout + err.stderr;
            } else {
                return 'Unknown Err';
            }
        }
    }

    async update(checkin: FossilCheckin): Promise<void> {
        await this.exec(['update', checkin]);
    }

    async commit(
        message: FossilCommitMessage,
        fileList: RelativePath[],
        user: FossilUsername | null,
        newBranch: NewBranchOptions | undefined
    ): Promise<void> {
        try {
            // always pass a message, otherwise fossil
            // internal editor will spawn
            await this.exec([
                'commit',
                ...(user ? ['--user-override', user] : []),
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
        } catch (err) {
            if (
                err instanceof FossilError &&
                /partial commit of a merge/.test(err.stderr || '')
            ) {
                err.fossilErrorCode = 'UnmergedChanges';
                throw err;
            }

            throw err;
        }
    }

    async getCurrentBranch(): Promise<FossilBranch | undefined> {
        try {
            const res = await this.exec(['branch', 'current']);
            return res.stdout.trim() as FossilBranch;
        } catch {
            return undefined;
        }
    }

    async newBranch(newBranch: NewBranchOptions): Promise<void> {
        try {
            await this.exec([
                'branch',
                'new',
                newBranch.branch,
                'current',
                ...(newBranch.isPrivate ? ['--private'] : []),
                ...(newBranch.color ? ['--bgcolor', newBranch.color] : []),
            ]);
        } catch (err) {
            if (
                err instanceof FossilError &&
                /a branch of the same name already exists/.test(err.stderr)
            ) {
                err.fossilErrorCode = 'BranchAlreadyExists';
            }
            throw err;
        }
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
        ); // -C = no-backup

        for (const task of tasks) {
            await task();
        }
    }

    async remove(paths: RelativePath[]): Promise<void> {
        const pathsByGroup = groupBy(paths, p => path.dirname(p));
        const groups = Object.keys(pathsByGroup).map(k => pathsByGroup[k]);
        const tasks = groups.map(paths => () => this.exec(['rm', ...paths]));

        for (const task of tasks) {
            await task();
        }
    }

    async rename(oldPath: RelativePath, newPath: RelativePath): Promise<void> {
        await this.exec(['rename', oldPath, newPath]);
    }

    async clean(paths: string[]): Promise<void> {
        if (paths) {
            await this.exec(['clean', ...paths]);
        }
    }

    /**
     * this method differs from `clean` because cleaning empty
     * paths[] will cause damage
     */
    async cleanAll(): Promise<void> {
        this.exec(['clean']);
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
    ): Promise<FossilUndoCommand | undefined>;
    async undoOrRedo(
        command: 'undo' | 'redo',
        dryRun: boolean
    ): Promise<FossilUndoCommand | undefined> {
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
            const error = new FossilError({
                message: `Unexpected undo result: ${JSON.stringify(
                    result.stdout
                )}`,
                fossilErrorCode: 'unknown',
                ...result,
            });
            if (
                /^nothing to undo/.test(result.stderr) || // non dry
                /^No undo or redo is available/.test(result.stdout) // dry
            ) {
                error.fossilErrorCode = 'NoUndoInformationAvailable';
            }

            throw error;
        }

        return match[2] as FossilUndoCommand;
    }

    async pull(options: PullOptions): Promise<void> {
        await this.exec([options?.autoUpdate ? 'update' : 'pull']);
    }

    async push(): Promise<void> {
        try {
            await this.exec(['push']);
        } catch (err) {
            if (
                err instanceof FossilError &&
                /would fork/.test(err.stderr || '')
            ) {
                err.fossilErrorCode = 'PushCreatesNewRemoteHead';
            }

            throw err;
        }
    }

    private parseUntrackedFilenames(stderr: FossilStdErr): string[] {
        const untrackedFilesPattern = /([^:]+): untracked file differs\n/g;
        let match: RegExpExecArray | null;
        const files: string[] = [];
        while ((match = untrackedFilesPattern.exec(stderr))) {
            if (match !== null) {
                files.push(match[1]);
            }
        }
        return files;
    }

    async merge(
        checkin: FossilCheckin,
        integrate: MergeAction
    ): Promise<IMergeResult> {
        try {
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
            await this.exec(['merge', checkin, ...extraArgs]);
            return {
                unresolvedCount: 0,
            };
        } catch (e) {
            if (
                e instanceof FossilError &&
                e.stderr.match(/untracked files in working directory differ/)
            ) {
                e.fossilErrorCode = 'UntrackedFilesDiffer';
                e.untrackedFilenames = this.parseUntrackedFilenames(e.stderr);
            }

            if (e instanceof FossilError && e.exitCode === 1) {
                const match = e.stdout.match(/(\d+) files unresolved/);
                if (match) {
                    return {
                        unresolvedCount: parseInt(match[1]),
                    };
                }
            }

            throw e;
        }
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
                        stashId: parseInt(match[1], 10),
                        hash: match[2],
                        date: new Date(match[3]),
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
        stashId: number
    ): Promise<void> {
        await this.exec(['stash', operation, stashId.toString()]);
    }

    getSummary(summary: StatusString): IRepoStatus {
        const parent = this.parseParentLines(summary);
        const isMerge = /^(MERGED_WITH|CHERRYPICK)\b/m.test(summary);
        return { isMerge, parent };
    }

    private parseParentLines(
        parentLines: StatusString
    ): FossilHash | undefined {
        const match = parentLines.match(/parent:\s+([a-f0-9]+)/);
        if (match) {
            return match[1] as FossilHash;
        }
        return undefined;
    }

    /** Report the change status of files in the current checkout */
    @throttle
    async getStatus(reason: string): Promise<StatusString> {
        // quiet, include renames/copies of current checkout
        const executionResult = await this.exec(['status'], reason);
        return executionResult.stdout as StatusString;
    }
    /**
     * @param line: line from `fossil status` of `fossil timeline --verbose`
     */
    private parseStatusLine(line: string): IFileStatus | undefined {
        // regexp:
        // 1) (?:\s{3})? at the start of the line there are 0 or 3 spaces
        // 2) ([A-Z_]+) single uppercase word
        // 3) (?<=[^:]) not ending with ':' (see `fossil status` for idea)
        // 4) \s+(.+)$ everything to the end of the line
        const match = line.match(/^(?:\s{3})?([A-Z_]+)(?<=[^:])\s+(.+)$/);
        if (!match) {
            return undefined;
        }
        const [_, rawStatus, path] = match;
        switch (rawStatus) {
            case 'EDITED':
            case 'EXECUTABLE':
            case 'UPDATED_BY_INTEGRATE':
            case 'UPDATED_BY_MERGE':
                return { status: 'M', path };
            case 'ADDED_BY_INTEGRATE':
            case 'ADDED_BY_MERGE':
            case 'ADDED':
                return { status: 'A', path };
            case 'DELETED':
                return { status: 'R', path };
            case 'MISSING':
                return { status: '!', path };
            case 'CONFLICT':
                return { status: 'C', path };
            case 'RENAMED': {
                // since fossil 2.19 there's '  ->  '
                const [from_path, to_path] = path.split('  ->  ');
                return {
                    status: 'A',
                    path: from_path,
                    rename: to_path ?? from_path,
                };
            }
        }
        return;
    }

    parseStatusLines(status: StatusString): IFileStatus[] {
        const result: IFileStatus[] = [];

        status.split('\n').forEach(line => {
            const match = this.parseStatusLine(line);
            if (!match) {
                return;
            }
            result.push(match);
        });
        return result;
    }

    async getExtras(): Promise<IFileStatus[]> {
        const executionResult = await this.exec(['extras']);
        return this.parseExtrasLines(executionResult.stdout);
    }

    private parseExtrasLines(extraString: FossilStdOut): IFileStatus[] {
        const result: IFileStatus[] = [];
        const lines = extraString.split('\n');
        lines.forEach(line => {
            if (line.length > 0) {
                const fileUri: string = line.trim();
                result.push({ status: '?', path: fileUri });
            }
        });
        return result;
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
                const status = this.parseStatusLine(line);
                if (status) {
                    lastFiles.push(status);
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
                    date: new Date(date),
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

    async getRemotes(): Promise<FossilRemote> {
        const pathsResult = await this.exec(['remote-url']);
        return {
            name: 'path' as FossilRemoteName,
            url: Uri.parse(pathsResult.stdout.trim()) as FossilURI,
        };
    }
}
