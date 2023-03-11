import {
    Distinct,
    FossilPath,
    FossilRoot,
    FossilURI,
    OpenedRepository,
} from './fossilBase';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
    EventEmitter,
    Event,
    window,
    OutputChannel,
    ProgressLocation,
} from 'vscode';
import * as cp from 'child_process';
import { dispose, IDisposable, toDisposable } from './util';
import { interaction } from './interaction';

/** usually two numbers like [2,19] */
export type FossilVersion = Distinct<number[], 'fossil version'>;

export interface IFossilOptions {
    fossilPath: FossilExecutablePath;
    version: FossilVersion;
    outputChannel: OutputChannel;
}

/** cwd for executing fossil */
export type FossilCWD =
    | Distinct<string, 'cwd for executing fossil'>
    | FossilRoot;

export type FossilExecutablePath = Distinct<string, 'fossil executable path'>;

export interface FossilSpawnOptions extends cp.SpawnOptionsWithoutStdio {
    cwd: FossilCWD;
    logErrors?: boolean; // whether to log stderr to the fossil outputChannel
    stdin_data?: string; // dump data to stdin
}

export interface IExecutionResult {
    fossilPath: FossilExecutablePath;
    exitCode: number;
    stdout: string;
    stderr: string;
    args: string[];
    cwd: FossilCWD;
}

export interface IFossilErrorData extends IExecutionResult {
    message: string;
    fossilErrorCode: FossilErrorCode;
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

const enum Inline {
    ENOENT = -1002, // special code for NodeJS.ErrnoException
}

type FossilCommand =
    | 'mv'
    | 'wiki'
    | 'test-wiki-render'
    | 'test-markdown-render'
    | 'pull'
    | 'push'
    | 'extras'
    | 'timeline'
    | 'merge'
    | 'clean'
    | 'remote-url'
    | 'info'
    | 'branch'
    | 'revert'
    | 'rm'
    | 'tag'
    | 'amend'
    | 'commit'
    | 'status'
    | 'cat'
    | 'clone'
    | 'open'
    | 'init'
    | 'stash'
    | 'undo'
    | 'redo'
    | 'patch'
    | 'add'
    | 'update'
    | 'close'
    | 'ls';
export type FossilArgs = [FossilCommand, ...string[]];

async function exec(
    fossilPath: FossilExecutablePath,
    args: FossilArgs,
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
        }).catch((e: NodeJS.ErrnoException) => {
            if (e.code === 'ENOENT') {
                // most likely cwd was deleted
                return Inline.ENOENT;
            }
            throw e;
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

export class FossilExecutable {
    private readonly fossilPath: FossilExecutablePath;
    private readonly outputChannel: OutputChannel;
    public readonly version: FossilVersion;
    private openRepository: OpenedRepository | undefined;
    private readonly _onOutput = new EventEmitter<string>();
    get onOutput(): Event<string> {
        return this._onOutput.event;
    }

    constructor(options: IFossilOptions) {
        this.fossilPath = options.fossilPath;
        this.outputChannel = options.outputChannel;
        this.version = options.version;
    }

    open(repository: FossilRoot): OpenedRepository {
        this.openRepository = new OpenedRepository(this, repository);
        return this.openRepository;
    }

    async init(
        fossilRoot: FossilCWD,
        fossilPath: FossilPath,
        projectName: string, // since fossil 2.18
        projectDesc: string // since fossil 2.18
    ): Promise<void> {
        await this.exec(fossilRoot, [
            'init',
            fossilPath,
            ...(projectName ? ['--project-name', projectName] : []),
            ...(projectDesc ? ['--project-desc', projectDesc] : []),
        ]);
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
        fossilCwd: FossilCWD
    ): Promise<void> {
        await this.exec(fossilCwd, ['open', fossilPath]);
    }

    async openCloneForce(
        fossilPath: FossilPath,
        fossilCwd: FossilCWD
    ): Promise<void> {
        await this.exec(fossilCwd, ['open', fossilPath, '--force']);
    }

    /**
     *
     * @param path any path inside opened repository
     * @returns path's root directory
     */
    async getRepositoryRoot(anypath: string): Promise<FossilRoot> {
        const isFile = (await fs.stat(anypath)).isFile();
        const cwd = (isFile ? path.dirname(anypath) : anypath) as FossilCWD;
        const result = await this.exec(
            cwd,
            ['status'],
            `getting root for '${anypath}'`
        );
        const root = result.stdout.match(/local-root:\s*(.+)\/\s/);
        if (root) {
            return root[1] as FossilRoot;
        }
        return '' as FossilRoot;
    }

    async exec(
        cwd: FossilCWD,
        args: FossilArgs,
        reason = '',
        options: Omit<FossilSpawnOptions, 'cwd'> = {}
    ): Promise<IExecutionResult> {
        try {
            const result = await this._exec(args, reason, { cwd, ...options });
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
        args: FossilArgs,
        reason: string,
        options: FossilSpawnOptions
    ): Promise<IExecutionResult> {
        const startTimeHR = process.hrtime();
        const logTimeout = setTimeout(
            () => this.logArgs(args, reason, 'still running'),
            500
        );

        const result: IExecutionResult = await exec(
            this.fossilPath,
            args,
            options
        );
        clearTimeout(logTimeout);

        const durationHR = process.hrtime(startTimeHR);
        this.logArgs(
            args,
            reason,
            `${Math.floor(msFromHighResTime(durationHR))}ms`
        );

        if (result.exitCode) {
            const fossilErrorCode: FossilErrorCode = (() => {
                if (/Authentication failed/.test(result.stderr)) {
                    return 'AuthenticationFailed';
                } else if (
                    /(not within an open checkout|specify the repository database|cannot find current working directory)/.test(
                        result.stderr
                    ) ||
                    result.exitCode == Inline.ENOENT
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
    private logArgs(args: string[], reason: string, info: string): void {
        if (args[0] == 'clone') {
            // replace password with 9 asterisks
            args = [...args];
            args[1] = args[1].replace(/(.*:\/\/.+:)(.+)(@.*)/, '$1*********$3');
        }
        this.log(
            `fossil ${args.join(' ')}: ${info}${
                reason ? ' // ' + reason : ''
            }\n`
        );
    }
}

function msFromHighResTime(hiResTime: [number, number]): number {
    const [seconds, nanoSeconds] = hiResTime;
    return seconds * 1e3 + nanoSeconds / 1e6;
}
