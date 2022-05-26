/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Ben Crowl. All rights reserved.
 *  Original Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as cp from 'child_process';
import { existsSync, appendFileSync, writeFileSync } from 'fs';
import { groupBy, IDisposable, toDisposable, dispose, mkdirp } from "./util";
import { EventEmitter, Event, workspace, window, Disposable, OutputChannel, Uri } from "vscode";
import { interaction } from './interaction';

type Distinct<T, DistinctName> = T & { __TYPE__: DistinctName };
/** path to .fossil */
export type FossilPath = Distinct<string, "path to .fossil">;
/** local root */
export type FossilRoot = Distinct<string, "local root">;
/** something? */
//export type FossilName = Distinct<Uri, "fossil name">;
/** URI for the close
 *
 * * http[s]://[userid[:password]@]host[:port][/path]
 * * ssh://[userid@]host[:port]/path/to/repo.fossil[?fossil=path/fossil.exe]
 * * [file://]path/to/repo.fossil
 */
export type FossilURI = Distinct<string, "Fossil URI">;

export interface IFossil {
    path: string;
    version: string;
}

export interface LogEntryRepositoryOptions extends LogEntryOptions {
    filePath?: string;
    limit?: number;
}

export interface LogEntryOptions {
    revQuery?: string;
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
    parents: Ref[];

}

export interface IFileStatus {
    status: string;
    path: string;
    rename?: string;
}

export interface ICommitDetails {
    message: string;
    affectedFiles: IFileStatus[];
}

export enum RefType {
    Branch,
    Tag,
    Commit
}

export interface Ref {
    type: RefType;
    name?: string;
    commit?: string;
}

export interface Path {
    name: string;
    url: string;
}

export interface FossilFindAttemptLogger {
    log(path: string);
}

export class FossilFinder {
    constructor(private logger: FossilFindAttemptLogger) { }

    private logAttempt(path: string) {
        this.logger.log(path);
    }

    public async find(hint?: string): Promise<IFossil> {
        const first = hint ? this.findSpecificFossil(hint) : Promise.reject<IFossil>(null);

        return first.then(undefined, () => this.findSpecificFossil('fossil'));
    }

    private parseVersion(raw: string): string {
        let match = raw.match(/version (.+)\[/);
        if (match) {
            return match[1];
        }

        return "?";
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
                        path,
                        version: this.parseVersion(output)
                    });
                }
                return e(new Error('Not found'))
            });
        });
    }
}

export interface IExecutionResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

export async function exec(child: cp.ChildProcess, no_err_check?: boolean): Promise<IExecutionResult> {
    const disposables: IDisposable[] = [];

    const once = (ee: NodeJS.EventEmitter, name: string, fn: (...args: any[]) => void ) => {
        ee.once(name, fn);
        disposables.push(toDisposable(() => ee.removeListener(name, fn)));
    };

    const on = (ee: NodeJS.EventEmitter, name: string, fn: (...args: any[]) => void) => {
        ee.on(name, fn);
        disposables.push(toDisposable(() => ee.removeListener(name, fn)));
    };

    const [exitCode, stdout, stderr] = await Promise.all<any>([
        new Promise<number>((c, e) => {
            once(child, 'error', e);
            once(child, 'exit', c);
        }),
        new Promise<string>(c => {
            const buffers: string[] = [];
            async function checkForPrompt(input: any) {
                buffers.push(input);
                const inputStr: string = input.toString()
                if (inputStr) {
                    if ((inputStr.endsWith("? ") || inputStr.endsWith("?") ||
                        inputStr.endsWith(": ") || inputStr.endsWith(":")) &&
                        !no_err_check) {
                        const resp = await interaction.inputPrompt(buffers.toString())
                        child.stdin.write(resp + '\n')
                    }
                }
            }
            on(child.stdout, 'data', b => checkForPrompt(b));
            once(child.stdout, 'close', () => c(buffers.join('')));
        }),
        new Promise<string>(c => {
            const buffers: string[] = [];
            on(child.stderr, 'data', b => buffers.push(b));
            once(child.stderr, 'close', () => c(buffers.join('')));
        })
    ]);

    dispose(disposables);

    return { exitCode, stdout, stderr };
}

export interface IFossilErrorData {
    error?: Error;
    message?: string;
    stdout?: string; // ToDo: remove '?'
    stderr?: string; // ToDo: remove '?'
    exitCode?: number;
    fossilErrorCode?: string;
    fossilCommand?: string;
}

export class FossilUndoDetails {
    revision: number;
    kind: string;
}

export class FossilError {

    error?: Error;
    message: string;
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    fossilErrorCode?: string;
    fossilCommand?: string;
    hgBranches?: string;
    hgFilenames?: string[];

    constructor(data: IFossilErrorData) {
        if (data.error) {
            this.error = data.error;
            this.message = data.error.message;
        }
        else {
            this.error = void 0;
        }

        this.message = this.message || data.message || 'Fossil error';
        this.stdout = data.stdout;
        this.stderr = data.stderr;
        this.exitCode = data.exitCode;
        this.fossilErrorCode = data.fossilErrorCode;
        this.fossilCommand = data.fossilCommand;
    }

    toString(): string {
        let result = this.message + ' ' + JSON.stringify({
            exitCode: this.exitCode,
            fossilErrorCode: this.fossilErrorCode,
            fossilCommand: this.fossilCommand,
            stdout: this.stdout,
            stderr: this.stderr
        }, [], 2);

        if (this.error) {
            result += (<any>this.error).stack;
        }

        return result;
    }
}

export interface IFossilOptions {
    fossilPath: string;
    version: string;
    env?: any;
    enableInstrumentation: boolean;
    outputChannel: OutputChannel;
}

// ToDo: make it enum
export const FossilErrorCodes = {
    AuthenticationFailed: 'AuthenticationFailed',
    NotAFossilRepository: 'NotAFossilRepository',
    UnmergedChanges: 'UnmergedChanges',
    PushCreatesNewRemoteHead: 'PushCreatesNewRemoteHead',
    NoSuchFile: 'NoSuchFile',
    BranchAlreadyExists: 'BranchAlreadyExists',
    NoUndoInformationAvailable: 'NoUndoInformationAvailable',
    UntrackedFilesDiffer: 'UntrackedFilesDiffer',
    DefaultRepositoryNotConfigured: 'DefaultRepositoryNotConfigured',
    OperationMustBeforced: 'OperationMustBeforced'
};

export class Fossil {

    private fossilPath: string;
    private outputChannel: OutputChannel;
    private disposables: Disposable[] = [];
    private openRepository: Repository | undefined;

    private _onOutput = new EventEmitter<string>();
    get onOutput(): Event<string> { return this._onOutput.event; }

    constructor(options: IFossilOptions) {
        this.fossilPath = options.fossilPath;
        this.outputChannel = options.outputChannel;
    }

    open(repository: string): Repository {
        this.openRepository = new Repository(this, repository);
        return this.openRepository;
    }

    async init(repository: FossilRoot, repoName: FossilPath): Promise<void> {
        await this.exec(repository, ['init', repoName]);
    }

    async clone(uri: FossilURI, parentPath: FossilRoot): Promise<FossilPath> {
        const folderName = uri.replace(/^.*\//, '') || 'repository';
        const folderPath = path.join(parentPath, folderName + '.fossil');

        await mkdirp(parentPath);
        await this.exec(parentPath, ['clone', uri, folderPath]);
        return folderPath as FossilPath;
    }

    async openClone(fossilPath: FossilPath, workdir: FossilRoot): Promise<void> {
        await this.exec(workdir, ['open', fossilPath]);
    }

    async openCloneForce(fossilPath: FossilPath, parentPath: FossilRoot): Promise<void> {
        await this.exec(parentPath, ['open', fossilPath, '--force']);
    }

    /**
     *
     * @param path any path inside opened repository
     * @returns path's root directory
     */
    async getRepositoryRoot(path: string): Promise<FossilRoot> {
        const result = await this.exec(path, ['stat']);
        var root = result.stdout.match(/local-root:\s*(.+)\/\s/);
        if (root) return root[1] as FossilRoot;
        return "" as FossilRoot
    }

    async exec(cwd: string, args: string[], options: any = {}): Promise<IExecutionResult> {
        options = { cwd, ...options };
        try {
            let result = await this._exec(args, options);
            return result
        }
        catch (err) {
            if (err instanceof FossilError &&
                err.fossilErrorCode !== FossilErrorCodes.NoSuchFile &&
                err.fossilErrorCode !== FossilErrorCodes.NotAFossilRepository &&
                err.fossilErrorCode !== FossilErrorCodes.OperationMustBeforced) {
                const openLog = await interaction.errorPromptOpenLog(err)
                if (openLog) {
                    this.outputChannel.show();
                }
            }
            throw err;
        }
    }

    private async _exec(args: string[], options: any = {}): Promise<IExecutionResult> {
        const startTimeHR = process.hrtime();

        let result: IExecutionResult;
        const child = this.spawn(args, options);
        result = await exec(child, args.includes('cat'));

        const durationHR = process.hrtime(startTimeHR);
        this.log(`fossil ${args.join(' ')}: ${Math.floor(msFromHighResTime(durationHR))}ms\n`);

        if (result.exitCode) {
            let fossilErrorCode: string | undefined = void 0;

            if (/Authentication failed/.test(result.stderr)) {
                fossilErrorCode = FossilErrorCodes.AuthenticationFailed;
            }
            else if (/not within an open checkout/.test(result.stderr) ||
                /specify the repository database/.test(result.stderr)) {
                fossilErrorCode = FossilErrorCodes.NotAFossilRepository;
            }
            else if (/no such file/.test(result.stderr)) {
                fossilErrorCode = FossilErrorCodes.NoSuchFile;
            } else if (/--force\b/.test(result.stderr)) {
                fossilErrorCode = FossilErrorCodes.OperationMustBeforced;
            }

            if (options.logErrors !== false && result.stderr) {
                this.log(`${result.stderr}\n`);
            }

            return Promise.reject<IExecutionResult>(new FossilError({
                message: 'Failed to execute fossil',
                stdout: result.stdout,
                stderr: result.stderr,
                exitCode: result.exitCode,
                fossilErrorCode,
                fossilCommand: args[0]
            }));
        }

        return result;
    }

    spawn(args: string[], options: any = {}): cp.ChildProcess {
        if (!this.fossilPath) {
            throw new Error('fossil could not be found in the system.');
        }

        if (!options) {
            options = {};
        }

        if (!options.stdio) {
            options.stdio = 'pipe';
        }

        options.env = {
            ...process.env,
            ...options.env,
            LC_ALL: 'en_US',
            LANG: 'en_US.UTF-8'
        }

        return cp.spawn(this.fossilPath, args, options);
    }

    private log(output: string): void {
        this._onOutput.fire(output);
    }
}

export interface Revision {
    hash: string;
}

export interface Commit extends Revision {
    branch: string;
    message: string;
    author: string;
    date: Date;
}

export interface CommitDetails extends Commit {
    files: IFileStatus[];
    parent1: string;
}

export class Repository {

    private status_msg: string = '';

    constructor(
        private _fossil: Fossil,
        private repositoryRoot: string
    ) { }

    get fossil(): Fossil {
        return this._fossil;
    }

    get root(): string {
        return this.repositoryRoot;
    }

    async exec(args: string[], options: any = {}): Promise<IExecutionResult> {
        return await this.fossil.exec(this.repositoryRoot, args, options);
    }

    async config(scope: string, key: string, value: any, options: any): Promise<string> {
        const args = ['config'];

        if (scope) {
            args.push('--' + scope);
        }

        args.push(key);

        if (value) {
            args.push(value);
        }

        const result = await this.exec(args, options);
        return result.stdout;
    }

    async add(paths?: string[]): Promise<void> {
        const args = ['add'];

        if (paths && paths.length) {
            args.push.apply(args, paths);
        }

        await this.exec(args);
    }

    async cat(relativePath: string, checkin: string): Promise<string> {
        const args = ['cat', relativePath];
        if (checkin) {
            args.push('-r', checkin);
        }
        const result = await this.exec(args, { logErrors: false });
        return result.stdout;
    }

    async close(): Promise<string> {
        const args = ['close'];
        try {
            const result = await this.exec(args);
            return result.stdout + result.stderr;
        }
        catch (err) {
            if (err instanceof FossilError && err.stderr) {
                return err.stdout + err.stderr
            }
            else {
                return 'Unknown Err'
            }
        }
    }

    async update(treeish: string, opts?: { discard: boolean }): Promise<void> {
        const args = ['update'];

        if (opts && opts.discard) {
            args.push('--dry-run');
        }

        if (treeish) {
            args.push(treeish);
        }

        try {
            await this.exec(args);
        }
        catch (err) {
            throw err;
        }
    }

    async commit(message: string, opts: { fileList: string[], user?: string | undefined } = Object.create(null)): Promise<void> {
        const disposables: IDisposable[] = [];
        const args = ['commit'];

        if (opts.user != undefined) {
            args.push('--user-override', opts.user);
        }

        if (opts.fileList.length) {
            args.push(...opts.fileList);
        }

        if (message && message.length) {
            args.push('-m', message);
        }

        try {
            await this.exec(args);
        }
        catch (err) {
            if (/partial commit of a merge/.test(err.stderr)) {
                err.fossilErrorCode = FossilErrorCodes.UnmergedChanges;
                throw err;
            }

            throw err;
        }
        finally {
            dispose(disposables);
        }
    }

    async branch(name: string, opts?: { force: boolean }): Promise<void> {
        const args = ['branch', 'new', name];
        const currBranch = await this.getCurrentBranch();
        if (currBranch && currBranch.name) {
            args.push(currBranch.name)
        }

        try {
            await this.exec(args);
        }
        catch (err) {
            if (err instanceof FossilError && /a branch of the same name already exists/.test(err.stderr || '')) {
                err.fossilErrorCode = FossilErrorCodes.BranchAlreadyExists;
            }

            throw err;
        }
    }

    async revert(paths: string[]): Promise<void> {
        const pathsByGroup = groupBy(paths, p => path.dirname(p));
        const groups = Object.keys(pathsByGroup).map(k => pathsByGroup[k]);
        const tasks = groups.map(paths => () => this.exec(['revert'].concat(paths))); // -C = no-backup

        for (let task of tasks) {
            await task();
        }
    }

    async remove(paths: string[]): Promise<void> {
        const pathsByGroup = groupBy(paths, p => path.dirname(p));
        const groups = Object.keys(pathsByGroup).map(k => pathsByGroup[k]);
        const tasks = groups.map(paths => () => this.exec(['rm'].concat(paths)));

        for (let task of tasks) {
            await task();
        }
    }

    async clean(): Promise<void> {
        this.exec(['clean']);
    }

    async ignore(paths: string[]): Promise<void> {
        const ignore_file = this.repositoryRoot + '/.fossil-settings/ignore-glob'
        if (existsSync(ignore_file)) {
            appendFileSync(ignore_file, paths.join('\n') + '\n')
        }
        else {
            mkdirp(this.repositoryRoot + '/.fossil-settings/')
            writeFileSync(ignore_file, paths.join('\n') + '\n');
            this.add([ignore_file])
        }
        const document = await workspace.openTextDocument(ignore_file)
        window.showTextDocument(document);
    }

    async undo(dryRun?: boolean): Promise<FossilUndoDetails> {
        const args = ['undo'];

        if (dryRun) {
            args.push('--dry-run');
        }

        try {
            const result = await this.exec(args);
            const match = /back to revision (\d+) \(undo (.*)\)/.exec(result.stdout);

            if (!match) {
                throw new FossilError({
                    message: `Unexpected undo result: ${JSON.stringify(result.stdout)}`,
                    stdout: result.stdout,
                    stderr: result.stderr,
                    exitCode: result.exitCode,
                    fossilCommand: "undo"
                })
            }

            const [_, revision, kind] = match;

            return {
                revision: parseInt(revision),
                kind
            };
        }
        catch (error) {
            if (error instanceof FossilError && /nothing to undo/.test(error.stderr || '')) {
                error.fossilErrorCode = FossilErrorCodes.NoUndoInformationAvailable;
            }
            throw error;
        }
    }

    async tryGetLastCommitDetails(): Promise<ICommitDetails> {
        try {
            return {
                message: await this.getLastCommitMessage(),
                affectedFiles: this.parseStatusLines(this.status_msg)
            }
        }
        catch (e) {
            return {
                message: "",
                affectedFiles: []
            };
        }
    }

    async revertFiles(treeish: string, paths: string[]): Promise<void> {
        let args: string[] = ['revert'];

        if (paths && paths.length) {
            args.push.apply(args, paths);
        }

        try {
            await this.exec(args);
        }
        catch (err) {
            // In case there are merge conflicts to be resolved, fossil reset will output
            // some "needs merge" data. We try to get around that.
            if (/([^:]+: needs merge\n)+/m.test(err.stdout || '')) {
                return;
            }

            throw err;
        }
    }

    async pull(options?: PullOptions): Promise<void> {
        var args = ['pull'];

        if (options && options.autoUpdate) {
            args = ['update'];
        }

        try {
            await this.exec(args);
        }
        catch (err) {
            throw err;
        }
    }

    async push(): Promise<void> {
        const args = ['push'];

        try {
            await this.exec(args);
        }
        catch (err) {
            if (/would fork/.test(err.stderr || '')) {
                err.fossilErrorCode = FossilErrorCodes.PushCreatesNewRemoteHead;
            }

            throw err;
        }
    }

    private parseUntrackedFilenames(stderr: string): string[] {
        const untrackedFilesPattern = /([^:]+): untracked file differs\n/g;
        let match: RegExpExecArray | null;
        const files: string[] = [];
        while (match = untrackedFilesPattern.exec(stderr)) {
            if (match !== null) {
                files.push(match[1]);
            }
        }
        return files;
    }

    async merge(revQuery: string): Promise<IMergeResult> {
        try {
            await this.exec(['merge', revQuery]);
            return {
                unresolvedCount: 0
            }
        }
        catch (e) {
            if (e instanceof FossilError && e.stderr && e.stderr.match(/untracked files in working directory differ/)) {
                e.fossilErrorCode = FossilErrorCodes.UntrackedFilesDiffer;
                e.hgFilenames = this.parseUntrackedFilenames(e.stderr);
            }

            if (e instanceof FossilError && e.exitCode === 1) {
                const match = (e.stdout || "").match(/(\d+) files unresolved/);
                if (match) {
                    return {
                        unresolvedCount: parseInt(match[1])
                    }
                }
            }

            throw e;
        }
    }

    async getSummary(): Promise<IRepoStatus> {
        const summary = this.status_msg;
        const parents = this.parseParentLines(summary);
        const isMerge = /\bMERGED WITH\b/.test(summary);
        return { isMerge, parents };
    }

    parseParentLines(parentLines: string): Ref[] {
        const refs: Ref[] = [];
        const match = parentLines.match(/parent:\s+([a-f0-9]+)/);
        if (match) {
            const [_, hash] = match;
            refs.push({
                type: RefType.Commit,
                commit: hash
            });
        }
        return refs;
    }

    async getLastCommitMessage(): Promise<string> {
        const message = this.status_msg;
        var comment = message.match(/comment:\s+(.*)\(/)
        if (comment) return comment[1];
        return "";
    }

    async getLastCommitAuthor(): Promise<string> {
        const message = this.status_msg;
        var comment = message.match(/user:\s+(.*)\n/)
        if (comment) return comment[1];
        return "";
    }

    async getLastCommitDate(): Promise<string> {
        const message = this.status_msg;
        var comment = message.match(/checkout:\s+(.*)\s(.*)\n/)
        if (comment) return comment[2];
        return "";
    }

    async getStatus(): Promise<string> {
        const args = ['status'];
        const executionResult = await this.exec(args); // quiet, include renames/copies
        this.status_msg = executionResult.stdout;
        return executionResult.stdout;
    }

    parseStatusLines(status: string): IFileStatus[] {
        const result: IFileStatus[] = [];
        let lines = status.split("\n");

        lines.forEach(line => {
            if (line.length > 0) {
                if (line.startsWith("UPDATED_BY_MERGE")) {
                    var fileUri: string = line.substr(17).trim();
                    result.push({ status: "M", path: fileUri });
                }
                else if (line.startsWith("ADDED_BY_MERGE")) {
                    var fileUri: string = line.substr(15).trim();
                    result.push({ status: "A", path: fileUri });
                }
                else if (line.startsWith("DELETED")) {
                    var fileUri: string = line.substr(8).trim();
                    result.push({ status: "R", path: fileUri });
                }
                else if (line.startsWith("EDITED")) {
                    var fileUri: string = line.substr(7).trim();
                    result.push({ status: "M", path: fileUri });
                }
                else if (line.startsWith("ADDED")) {
                    var fileUri: string = line.substr(6).trim();
                    result.push({ status: "A", path: fileUri });
                }
                else if (line.startsWith("MISSING")) {
                    var fileUri: string = line.substr(8).trim();
                    result.push({ status: "!", path: fileUri });
                }
                else if (line.startsWith("CONFLICT")) {
                    var fileUri: string = line.substr(9).trim();
                    result.push({ status: "C", path: fileUri });
                }
            }
        });
        return result;
    }

    async getExtras(): Promise<string> {
        const args = ['extras'];
        const executionResult = await this.exec(args);
        return executionResult.stdout;
    }

    parseExtrasLines(status: string): IFileStatus[] {
        const result: IFileStatus[] = [];
        let lines = status.split("\n");
        lines.forEach(line => {
            if (line.length > 0) {
                var fileUri: string = line.trim();
                result.push({ status: "?", path: fileUri });
            }
        });
        return result;
    }

    async getCurrentBranch(): Promise<Ref> {
        const message = this.status_msg;
        var branch = message.match(/tags:\s+(.*)\b(.*)\n/)
        var comment = message.match(/comment:\s+(.*)\(/)
        if (branch && comment) {
            return { name: branch[1], commit: comment[1], type: RefType.Branch };
        }
        return { name: "", commit: "", type: RefType.Branch };
    }

    async getLogEntries({ revQuery, filePath, limit }: LogEntryRepositoryOptions = {}): Promise<Commit[]> {
        const args = ['timeline']

        if (revQuery) {
            args.push('before', revQuery);
        }
        if (limit) {
            args.push('-n', `${limit}`);
        }

        if (filePath) {
            args.push('-p', filePath);
        }
        args.push('--type', 'ci');
        args.push('--format', '%H+++%d+++%b+++%a+++%c')

        const result = await this.exec(args);
        const logEntries = result.stdout.trim().split('\n')
            .filter(line => !!line && !line.startsWith("+++"))
            .map((line: string): Commit => {
                const parts = line.split("+++", 5);
                const [hash, date, branch, author, message] = parts;
                return {
                    hash: hash,
                    branch: branch,
                    message: message,
                    author: author,
                    date: new Date(date),
                }
            }) as Commit[];
        return logEntries;
    }

    async getParents(): Promise<string> {
        var comment = this.status_msg.match(/parent:\s+(.*)\s(.*)\n/)
        if (comment) return comment[1];
        return "";
    }

    async getTags(): Promise<Ref[]> {
        const tagsResult = await this.exec(['tag', 'list']);
        const tagRefs = tagsResult.stdout.trim().split('\n')
            .filter(line => !!line)
            .map((line: string): Ref | null => {
                return { name: line, commit: line, type: RefType.Tag };
            })
            .filter(ref => !!ref) as Ref[];

        return tagRefs;
    }

    async getBranches(): Promise<Ref[]> {
        const branchesResult = await this.exec(['branch']);
        const branchRefs = branchesResult.stdout.trim().split('\n')
            .filter(line => !!line)
            .map((line: string): Ref | null => {
                let match = line.match(/\b(.+)$/);
                if (match) {
                    return { name: match[1], commit: match[1], type: RefType.Branch };
                }
                return null;
            })
            .filter(ref => !!ref) as Ref[];

        return branchRefs;
    }

    async getPaths(): Promise<Path> {
        const pathsResult = await this.exec(['remote-url']);
        return { name: 'path', url: pathsResult.stdout.trim() };
    }
}

function msFromHighResTime(hiResTime: [number, number]): number {
    const [seconds, nanoSeconds] = hiResTime;
    return seconds * 1e3 + nanoSeconds / 1e6;
}