/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ben Crowl. All rights reserved.
 *  Original Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as cp from 'child_process';
import * as fs from 'fs/promises';
import { appendFileSync, existsSync, writeFileSync } from 'fs';
import { groupBy, IDisposable, toDisposable, dispose } from './util';
import {
    EventEmitter,
    Event,
    workspace,
    window,
    OutputChannel,
    Uri,
    ProgressLocation,
} from 'vscode';
import { interaction } from './interaction';
import { throttle } from './decorators';

type Distinct<T, DistinctName> = T & { __TYPE__: DistinctName };
/** path to .fossil */
export type FossilPath = Distinct<string, 'path to .fossil'>;
/** local repository root */
export type FossilRoot = Distinct<string, 'local repository root'>;
/** cwd for executing fossil */
export type FossilCWD =
    | Distinct<string, 'cwd for executing fossil'>
    | FossilRoot;
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
export const FossilSpecialTagsList = ['current', 'parent', 'tip'] as const;
export type FossilSpecialTags = typeof FossilSpecialTagsList[number];
export type FossilTag = Distinct<string, 'Fossil Tag Name'> | 'closed';
export type FossilHash = Distinct<string, 'Fossil SHA Hash'>;
export type FossilCheckin =
    | FossilBranch
    | FossilTag
    | FossilHash
    | FossilSpecialTags;
/** Stdout of `fossil status` command */
export type StatusString = Distinct<string, 'fossil status stdout'>;
export type FossilExecutablePath = Distinct<string, 'fossil executable path'>;
/** usually two numbers like [2,19] */
export type FossilVersion = Distinct<number[], 'fossil version'>;
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

export interface IFossil {
    path: FossilExecutablePath;
    version: FossilVersion;
}

export interface TimelineOptions extends LogEntryOptions {
    /** Output items affecting filePath only */
    filePath?: string;
    /**
     * If `limit` is positive, output the first N entries. If
     * N is negative, output the first -N lines. If `limit` is
     * zero, no limit.  Default is -20 meaning 20 lines.
     */
    limit: number;
    /** Output the list of files changed by each commit */
    verbose?: boolean;
}

export interface LogEntryOptions {
    checkin?: FossilCheckin;
}

export interface PullOptions {
    branch?: string;
    revs?: string[];
    autoUpdate: boolean; // run an update after the pull?
}

export interface IMergeResult {
    unresolvedCount: number;
}

export interface IRepoStatus {
    isMerge: boolean;
    parent?: FossilHash;
}

export interface IFileStatus {
    status: 'M' | 'A' | 'R' | 'C' | '!' | '?';
    path: string;
    rename?: string; // ToDo: remove `rename` field
}

export interface BranchDetails {
    name: FossilBranch;
    isCurrent: boolean;
    isPrivate: boolean;
}

export interface FossilRemote {
    name: FossilRemoteName;
    url: FossilURI;
}

export interface StashItem {
    stashId: number;
    hash: string;
    date: Date;
    comment: FossilCommitMessage;
}

export interface FossilFindAttemptLogger {
    log(path: string): void;
}

interface FossilSpawnOptions extends cp.SpawnOptionsWithoutStdio {
    cwd: FossilCWD;
    logErrors?: boolean; // whether to log stderr to the fossil outputChannel
    stdin_data?: string; // dump data to stdout
}

export class FossilFinder {
    constructor(private logger: FossilFindAttemptLogger) {}

    private logAttempt(path: string) {
        this.logger.log(path);
    }

    public async find(hint?: string): Promise<IFossil> {
        const first = hint
            ? this.findSpecificFossil(hint)
            : Promise.reject<IFossil>(null);

        return first.then(undefined, () => this.findSpecificFossil('fossil'));
    }

    private parseVersion(raw: string): FossilVersion {
        const match = raw.match(/version (.+)\[/);
        if (match) {
            return match[1].split('.').map(s => parseInt(s)) as FossilVersion;
        }
        return [0] as FossilVersion;
    }

    private findSpecificFossil(path: string): Promise<IFossil> {
        return new Promise<IFossil>((c, e) => {
            const buffers: Buffer[] = [];
            this.logAttempt(path);
            const child = cp.spawn(path, ['version']);
            child.stdout.on('data', (b: Buffer) => buffers.push(b));
            child.on('error', e);
            child.on('exit', code => {
                if (!code) {
                    const output = Buffer.concat(buffers).toString('utf8');
                    return c({
                        path: path as FossilExecutablePath,
                        version: this.parseVersion(output),
                    });
                }
                return e(new Error('Not found'));
            });
        });
    }
}

export interface IExecutionResult {
    fossilPath: FossilExecutablePath;
    exitCode: number;
    stdout: string;
    stderr: string;
    args: string[];
    cwd: FossilCWD;
}

async function exec(
    fossilPath: FossilExecutablePath,
    args: string[],
    options: FossilSpawnOptions
): Promise<IExecutionResult> {
    if (!fossilPath) {
        throw new Error('fossil could not be found in the system.');
    }

    if (!options.stdio) {
        options.stdio = 'pipe';
    }

    options.env = {
        ...process.env,
        ...options.env,
        LC_ALL: 'en_US',
        LANG: 'en_US.UTF-8',
    };

    const child = cp.spawn(fossilPath, args, options);

    const disposables: IDisposable[] = [];

    const once = (
        ee: NodeJS.EventEmitter,
        name: string,
        fn: (...args: any[]) => void
    ) => {
        ee.once(name, fn);
        disposables.push(toDisposable(() => ee.removeListener(name, fn)));
    };

    const on = (
        ee: NodeJS.EventEmitter,
        name: string,
        fn: (...args: any[]) => void
    ) => {
        ee.on(name, fn);
        disposables.push(toDisposable(() => ee.removeListener(name, fn)));
    };
    let readTimeout: NodeJS.Timeout | undefined = undefined;
    const buffers: Buffer[] = [];

    async function onReadTimeout(): Promise<void> {
        if (!buffers.length) {
            return;
        }
        const stringThatMightBePrompt = buffers[buffers.length - 1].toString();
        if (/[:?]\s?$/.test(stringThatMightBePrompt)) {
            const stdout = Buffer.concat(buffers).toString('utf8');
            buffers.length = 0;
            const resp = await interaction.inputPrompt(stdout, args);
            child.stdin.write(resp + '\n');
        }
    }

    const checkForPrompt = !['cat', 'status'].includes(args[0]);
    if (options.stdin_data !== undefined) {
        child.stdin.write(options.stdin_data);
        child.stdin.end();
    }

    const [exitCode, stdout, stderr] = await Promise.all([
        new Promise<number>((c, e) => {
            once(child, 'error', e);
            once(child, 'exit', c);
        }),
        new Promise<string>(c => {
            function pushBuffer(buffer: Buffer) {
                buffers.push(buffer);
                if (checkForPrompt) {
                    clearTimeout(readTimeout);
                    readTimeout = setTimeout(() => onReadTimeout(), 50);
                }
            }
            on(child.stdout!, 'data', b => pushBuffer(b));
            once(child.stdout!, 'close', () =>
                c(Buffer.concat(buffers).toString('utf8'))
            );
        }),
        new Promise<string>(c => {
            const buffers: Buffer[] = [];
            on(child.stderr!, 'data', b => buffers.push(b));
            once(child.stderr!, 'close', () =>
                c(Buffer.concat(buffers).toString('utf8'))
            );
        }),
    ]);
    clearTimeout(readTimeout);

    dispose(disposables);

    return { fossilPath, exitCode, stdout, stderr, args, cwd: options.cwd };
}

export interface IFossilErrorData extends IExecutionResult {
    message: string;
    fossilErrorCode: FossilErrorCode;
}

export class FossilError implements IFossilErrorData {
    readonly fossilPath: FossilExecutablePath;
    readonly message: string;
    readonly stdout: string;
    readonly stderr: string;
    readonly exitCode: number;
    fossilErrorCode: FossilErrorCode;
    readonly args: string[];
    untrackedFilenames?: string[];
    readonly cwd: FossilCWD;

    constructor(data: IFossilErrorData) {
        this.fossilPath = data.fossilPath;
        this.message = data.message;
        this.stdout = data.stdout;
        this.stderr = data.stderr;
        this.exitCode = data.exitCode;
        this.fossilErrorCode = data.fossilErrorCode;
        this.args = data.args;
        this.cwd = data.cwd;
    }

    toString(): string {
        const result =
            this.message +
            ' ' +
            JSON.stringify(
                {
                    exitCode: this.exitCode,
                    fossilErrorCode: this.fossilErrorCode,
                    args: this.args,
                    stdout: this.stdout,
                    stderr: this.stderr,
                    cwd: this.cwd,
                    fossilPath: this.fossilPath,
                },
                null,
                2
            );

        return result;
    }
}

export interface IFossilOptions {
    fossilPath: FossilExecutablePath;
    version: FossilVersion;
    outputChannel: OutputChannel;
}

export type FossilErrorCode =
    | 'AuthenticationFailed'
    | 'NotAFossilRepository'
    | 'UnmergedChanges'
    | 'PushCreatesNewRemoteHead'
    | 'NoSuchFile'
    | 'BranchAlreadyExists'
    | 'NoUndoInformationAvailable'
    | 'UntrackedFilesDiffer'
    | 'DefaultRepositoryNotConfigured'
    | 'OperationMustBeForced'
    | 'unknown';

export class Fossil {
    private readonly fossilPath: FossilExecutablePath;
    private readonly outputChannel: OutputChannel;
    public readonly version: FossilVersion;
    private openRepository: Repository | undefined;
    private _onOutput = new EventEmitter<string>();
    get onOutput(): Event<string> {
        return this._onOutput.event;
    }

    constructor(options: IFossilOptions) {
        this.fossilPath = options.fossilPath;
        this.outputChannel = options.outputChannel;
        this.version = options.version;
    }

    open(repository: FossilRoot): Repository {
        this.openRepository = new Repository(this, repository);
        return this.openRepository;
    }

    async init(
        fossilRoot: FossilRoot,
        fossilPath: FossilPath,
        projectName: string, // since fossil 2.18
        projectDesc: string // since fossil 2.18
    ): Promise<void> {
        const args = ['init', fossilPath];
        if (projectName) {
            args.push('--project-name', projectName);
        }
        if (projectDesc) {
            args.push('--project-desc', projectDesc);
        }
        await this.exec(fossilRoot, args);
    }

    async clone(uri: FossilURI, fossilPath: FossilPath): Promise<FossilRoot> {
        return window.withProgress(
            { location: ProgressLocation.SourceControl, title: 'Cloning...' },
            async (): Promise<FossilRoot> => {
                const fossilRoot = path.dirname(fossilPath) as FossilRoot;
                await fs.mkdir(fossilRoot, { recursive: true });
                await this.exec(fossilRoot, [
                    'clone',
                    uri.toString(),
                    fossilPath,
                    '--verbose',
                ]);
                return fossilRoot;
            }
        );
    }

    async openClone(
        fossilPath: FossilPath,
        workdir: FossilRoot
    ): Promise<void> {
        await this.exec(workdir, ['open', fossilPath]);
    }

    async openCloneForce(
        fossilPath: FossilPath,
        parentPath: FossilRoot
    ): Promise<void> {
        await this.exec(parentPath, ['open', fossilPath, '--force']);
    }

    /**
     *
     * @param path any path inside opened repository
     * @returns path's root directory
     */
    async getRepositoryRoot(anypath: string): Promise<FossilRoot> {
        const isFile = (await fs.stat(anypath)).isFile();
        const cwd = (isFile ? path.dirname(anypath) : anypath) as FossilCWD;
        this.log(`getting root for '${anypath}'\n`);
        const result = await this.exec(cwd, ['status']);
        const root = result.stdout.match(/local-root:\s*(.+)\/\s/);
        if (root) {
            return root[1] as FossilRoot;
        }
        return '' as FossilRoot;
    }

    async exec(
        cwd: FossilCWD,
        args: string[],
        options: Omit<FossilSpawnOptions, 'cwd'> = {}
    ): Promise<IExecutionResult> {
        try {
            const result = await this._exec(args, { cwd, ...options });
            return result;
        } catch (err) {
            if (
                err instanceof FossilError &&
                err.fossilErrorCode !== 'NoSuchFile' &&
                err.fossilErrorCode !== 'NotAFossilRepository' &&
                err.fossilErrorCode !== 'OperationMustBeForced'
            ) {
                const openLog = await interaction.errorPromptOpenLog(err);
                if (openLog) {
                    this.outputChannel.show();
                }
            }
            throw err;
        }
    }

    private async _exec(
        args: string[],
        options: FossilSpawnOptions
    ): Promise<IExecutionResult> {
        const startTimeHR = process.hrtime();
        const logTimeout = setTimeout(
            () => this.logArgs(args, 'still running'),
            500
        );

        const result: IExecutionResult = await exec(
            this.fossilPath,
            args,
            options
        );
        clearTimeout(logTimeout);

        const durationHR = process.hrtime(startTimeHR);
        this.logArgs(args, `${Math.floor(msFromHighResTime(durationHR))}ms`);

        if (result.exitCode) {
            const fossilErrorCode: FossilErrorCode = (() => {
                if (/Authentication failed/.test(result.stderr)) {
                    return 'AuthenticationFailed';
                } else if (
                    /(not within an open checkout|specify the repository database|cannot find current working directory)/.test(
                        result.stderr
                    )
                ) {
                    return 'NotAFossilRepository';
                } else if (
                    /^(file .* does not exist in check-in|no such file:) /.test(
                        result.stderr
                    )
                ) {
                    return 'NoSuchFile';
                } else if (/--force\b/.test(result.stderr)) {
                    return 'OperationMustBeForced';
                }
                return 'unknown';
            })();

            if (options.logErrors !== false && result.stderr) {
                this.log(`${result.stderr}\n`);
            }

            return Promise.reject<IExecutionResult>(
                new FossilError({
                    message: 'Failed to execute fossil',
                    ...result,
                    fossilErrorCode,
                })
            );
        }

        return result;
    }

    private log(output: string): void {
        this._onOutput.fire(output);
    }
    private logArgs(args: string[], info: string): void {
        if (args[0] == 'clone') {
            // replace password with asterisks
            args = [...args];
            args[1] = args[1].replace(/(.*:\/\/.+:)(.+)(@.*)/, '$1*********$3');
        }
        this.log(`fossil ${args.join(' ')}: ${info}\n`);
    }
}

export interface Revision {
    hash: FossilHash;
}

export interface Commit extends Revision {
    branch: FossilBranch;
    message: FossilCommitMessage;
    author: string;
    date: Date;
}

export interface CommitDetails extends Commit {
    files: IFileStatus[];
}

export class Repository {
    constructor(private _fossil: Fossil, private repositoryRoot: FossilRoot) {}

    get fossil(): Fossil {
        return this._fossil;
    }

    get root(): FossilRoot {
        return this.repositoryRoot;
    }

    async exec(args: string[], options: any = {}): Promise<IExecutionResult> {
        return await this.fossil.exec(this.repositoryRoot, args, options);
    }

    async add(paths?: string[]): Promise<void> {
        const args = ['add'];

        if (paths?.length) {
            args.push(...paths);
        }

        await this.exec(args);
    }

    async ls(paths: string[]): Promise<string[]> {
        const args = ['ls', ...paths];
        const result = await this.exec(args);
        return result.stdout.split('\n').filter(Boolean);
    }

    async cat(relativePath: string, checkin: FossilCheckin): Promise<string> {
        const args = ['cat', relativePath];
        if (checkin) {
            args.push('-r', checkin);
        }
        const result = await this.exec(args, { logErrors: false });
        return result.stdout;
    }

    /**
     * @returns: close result. For example `there are unsaved changes
     *           in the current checkout` in case of an error or an empty
     *           string on success
     */
    async close(): Promise<string> {
        const args = ['close'];
        try {
            const result = await this.exec(args);
            return result.stdout + result.stderr;
        } catch (err) {
            if (err instanceof FossilError && err.stderr) {
                return err.stdout + err.stderr;
            } else {
                return 'Unknown Err';
            }
        }
    }

    async update(
        treeish: FossilCheckin,
        opts?: { discard: boolean }
    ): Promise<void> {
        const args = ['update'];

        if (opts?.discard) {
            args.push('--dry-run');
        }

        if (treeish) {
            args.push(treeish);
        }

        await this.exec(args);
    }

    async commit(
        message: string,
        opts: {
            fileList: string[];
            user?: FossilUsername | undefined;
            branch: FossilBranch | undefined;
        }
    ): Promise<void> {
        const disposables: IDisposable[] = [];
        const args = ['commit'];

        if (opts.user != undefined) {
            args.push('--user-override', opts.user);
        }

        args.push(...opts.fileList);
        if (opts.branch !== undefined) {
            args.push('--branch', opts.branch);
        }

        // always pass a message, otherwise fossil
        // internal editor will spawn
        args.push('-m', message);

        try {
            await this.exec(args);
        } catch (err) {
            if (
                err instanceof FossilError &&
                /partial commit of a merge/.test(err.stderr || '')
            ) {
                err.fossilErrorCode = 'UnmergedChanges';
                throw err;
            }

            throw err;
        } finally {
            dispose(disposables);
        }
    }

    async getCurrentBranch(): Promise<FossilBranch | undefined> {
        // bad? `fossil branch current` should show the branch
        const branches = await this.getBranches();
        const currBranch = branches.find(branch => branch.isCurrent)?.name;
        return currBranch;
    }

    async newBranch(name: FossilBranch): Promise<void> {
        const args = ['branch', 'new', name];
        const currBranch = await this.getCurrentBranch();
        if (currBranch) {
            args.push(currBranch);
        }

        try {
            await this.exec(args);
        } catch (err) {
            if (
                err instanceof FossilError &&
                /a branch of the same name already exists/.test(
                    err.stderr || ''
                )
            ) {
                err.fossilErrorCode = 'BranchAlreadyExists';
            }

            throw err;
        }
    }

    async addTag(fossilBranch: FossilBranch, tag: FossilTag): Promise<void> {
        await this.exec(['tag', 'add', '--raw', tag, fossilBranch]);
    }

    async cancelTag(
        fossilBranch: FossilCheckin,
        tag: FossilTag
    ): Promise<void> {
        await this.exec(['tag', 'cancel', '--raw', tag, fossilBranch]);
    }

    async updateCommitMessage(
        fossilCheckin: FossilCheckin,
        commitMessage: FossilCommitMessage
    ): Promise<void> {
        await this.exec(['amend', fossilCheckin, '--comment', commitMessage]);
    }

    async revert(paths: string[]): Promise<void> {
        const pathsByGroup = groupBy(paths, p => path.dirname(p));
        const groups = Object.keys(pathsByGroup).map(k => pathsByGroup[k]);
        const tasks = groups.map(
            paths => () => this.exec(['revert'].concat(paths))
        ); // -C = no-backup

        for (const task of tasks) {
            await task();
        }
    }

    async remove(paths: string[]): Promise<void> {
        const pathsByGroup = groupBy(paths, p => path.dirname(p));
        const groups = Object.keys(pathsByGroup).map(k => pathsByGroup[k]);
        const tasks = groups.map(
            paths => () => this.exec(['rm'].concat(paths))
        );

        for (const task of tasks) {
            await task();
        }
    }

    async clean(paths: string[]): Promise<void> {
        if (paths) {
            this.exec(['clean', ...paths]);
        }
    }

    /**
     * make this method differ from `clean` because cleaning empty
     * paths[] will cause damage
     */
    async cleanAll(): Promise<void> {
        this.exec(['clean']);
    }

    async ignore(paths: string[]): Promise<void> {
        const ignore_file =
            this.repositoryRoot + '/.fossil-settings/ignore-glob';
        if (existsSync(ignore_file)) {
            appendFileSync(ignore_file, paths.join('\n') + '\n');
        } else {
            await fs.mkdir(this.repositoryRoot + '/.fossil-settings/');
            writeFileSync(ignore_file, paths.join('\n') + '\n');
            this.add([ignore_file]);
        }
        const document = await workspace.openTextDocument(ignore_file);
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
        const args: string[] = [command];

        if (dryRun) {
            args.push('--dry-run');
        }

        const result = await this.exec(args);
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

    async revertFiles(treeish: string, paths: string[]): Promise<void> {
        const args: string[] = ['revert'];

        if (paths?.length) {
            args.push(...paths);
        }

        try {
            await this.exec(args);
        } catch (err) {
            // In case there are merge conflicts to be resolved, fossil reset will output
            // some "needs merge" data. We try to get around that.
            if (
                err instanceof FossilError &&
                /([^:]+: needs merge\n)+/m.test(err.stdout || '')
            ) {
                return;
            }

            throw err;
        }
    }

    async pull(options: PullOptions): Promise<void> {
        let args = ['pull'];

        if (options?.autoUpdate) {
            args = ['update'];
        }

        await this.exec(args);
    }

    async push(): Promise<void> {
        const args = ['push'];

        try {
            await this.exec(args);
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

    private parseUntrackedFilenames(stderr: string): string[] {
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
        revQuery: FossilCheckin,
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
            const args = ['merge', revQuery, ...extraArgs];
            await this.exec(args);
            return {
                unresolvedCount: 0,
            };
        } catch (e) {
            if (
                e instanceof FossilError &&
                e.stderr &&
                e.stderr.match(/untracked files in working directory differ/)
            ) {
                e.fossilErrorCode = 'UntrackedFilesDiffer';
                e.untrackedFilenames = this.parseUntrackedFilenames(e.stderr);
            }

            if (e instanceof FossilError && e.exitCode === 1) {
                const match = (e.stdout || '').match(/(\d+) files unresolved/);
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
        const args = ['patch', 'create', path];
        await this.exec(args);
    }

    async patchApply(path: string): Promise<void> {
        const args = ['patch', 'apply', path];
        await this.exec(args);
    }

    async stash(
        message: FossilCommitMessage,
        operation: 'save' | 'snapshot',
        paths: string[]
    ): Promise<void> {
        const args = ['stash', operation, '-m', message, ...paths];
        await this.exec(args);
    }

    async stashList(): Promise<StashItem[]> {
        const args = ['stash', 'list'];
        const res = await this.exec(args);
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
        const args = ['stash', operation, stashId.toString()];
        await this.exec(args);
    }

    getSummary(summary: string): IRepoStatus {
        const parent = this.parseParentLines(summary);
        const isMerge = /^(MERGED_WITH|CHERRYPICK)\b/m.test(summary);
        return { isMerge, parent };
    }

    private parseParentLines(parentLines: string): FossilHash | undefined {
        const match = parentLines.match(/parent:\s+([a-f0-9]+)/);
        if (match) {
            return match[1] as FossilHash;
        }
        return undefined;
    }

    /** Report the change status of files in the current checkout */
    @throttle
    async getStatus(): Promise<StatusString> {
        const args = ['status'];
        // quiet, include renames/copies of current checkout
        const executionResult = await this.exec(args);
        return executionResult.stdout as StatusString;
    }
    /**
     * @param line: line from `fossil status` of `fossil timeline --verbose`
     */
    parseStatusLine(line: string): IFileStatus | undefined {
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

    async getExtras(): Promise<string> {
        const args = ['extras'];
        const executionResult = await this.exec(args);
        return executionResult.stdout;
    }

    parseExtrasLines(extraString: string): IFileStatus[] {
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
        const args = ['timeline'];

        if (checkin) {
            args.push('before', checkin);
        }
        if (limit) {
            args.push('-n', `${limit}`);
        }
        if (filePath) {
            args.push('-p', filePath);
        }
        if (verbose) {
            args.push('--verbose');
        }
        args.push('--type', 'ci');
        args.push('--format', '%H+++%d+++%b+++%a+++%c');

        const result = await this.exec(args);

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
                    string,
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

    async getTags(): Promise<FossilTag[]> {
        const tagsResult = await this.exec(['tag', 'list']);
        // see comment from `getBranches`
        const tags = tagsResult.stdout.match(/^(.+)$/gm) as FossilTag[];
        return tags;
    }

    async getBranches(opts: { closed?: true } = {}): Promise<BranchDetails[]> {
        const args = ['branch', 'ls', '-t'];
        if (opts.closed) {
            args.push('-c');
        }
        const branchesResult = await this.exec(args);
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

function msFromHighResTime(hiResTime: [number, number]): number {
    const [seconds, nanoSeconds] = hiResTime;
    return seconds * 1e3 + nanoSeconds / 1e6;
}
