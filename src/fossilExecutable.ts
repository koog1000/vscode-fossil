import {
    Distinct,
    FossilPath,
    FossilRoot,
    FossilURI,
} from './openedRepository';
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
import * as interaction from './interaction';

/** usually two numbers like [2,19] */
export type FossilVersion = Distinct<number[], 'fossil version'>;
export type FossilStdOut = Distinct<
    string,
    'raw fossil stdout' | 'fossil status stdout' | 'RenderedHTML'
>;
export type FossilStdErr = Distinct<string, 'raw fossil stderr'>;

export interface IFossilOptions {
    readonly fossilPath: FossilExecutablePath;
    readonly version: FossilVersion;
    readonly outputChannel: OutputChannel;
}

/** cwd for executing fossil */
export type FossilCWD =
    | Distinct<string, 'cwd for executing fossil'>
    | FossilRoot;

export type FossilExecutablePath = Distinct<string, 'fossil executable path'>;

export interface FossilSpawnOptions extends cp.SpawnOptionsWithoutStdio {
    readonly cwd: FossilCWD;
    readonly logErrors?: boolean; // whether to log stderr to the fossil outputChannel
    readonly stdin_data?: string; // dump data to stdin
}

export interface IExecutionResult {
    readonly fossilPath: FossilExecutablePath;
    readonly exitCode: number;
    readonly stdout: FossilStdOut;
    readonly stderr: FossilStdErr;
    readonly args: FossilArgs;
    readonly cwd: FossilCWD;
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
    | 'DefaultRepositoryNotConfigured'
    | 'OperationMustBeForced'
    | 'unknown';

const enum Inline {
    ENOENT = -1002, // special code for NodeJS.ErrnoException
}

type FossilCommand =
    | 'add'
    | 'amend'
    | 'branch'
    | 'cat'
    | 'clean'
    | 'clone'
    | 'close'
    | 'commit'
    | 'diff'
    // | 'extras' - we get it from `fossil status --differ`
    | 'forget'
    | 'info'
    | 'init'
    | 'ls'
    | 'merge'
    | 'mv'
    | 'open'
    | 'patch'
    | 'praise'
    | 'pull'
    | 'push'
    | 'redo'
    | 'remote-url'
    | 'rename'
    | 'revert'
    | 'settings'
    | 'stash'
    | 'status'
    | 'tag'
    | 'test-markdown-render'
    | 'test-wiki-render'
    | 'timeline'
    | 'undo'
    | 'update'
    | 'wiki';

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
        name: 'close' | 'error' | 'exit',
        fn: (...args: any[]) => void
    ) => {
        ee.once(name, fn);
        disposables.push(toDisposable(() => ee.removeListener(name, fn)));
    };

    const on = (
        ee: NodeJS.EventEmitter,
        name: 'data',
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
            const stdout = Buffer.concat(buffers).toString(
                'utf8'
            ) as FossilStdOut;
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
        new Promise<FossilStdOut>(c => {
            function pushBuffer(buffer: Buffer) {
                buffers.push(buffer);
                if (checkForPrompt) {
                    clearTimeout(readTimeout);
                    readTimeout = setTimeout(() => onReadTimeout(), 50);
                }
            }
            on(child.stdout!, 'data', b => pushBuffer(b));
            once(child.stdout!, 'close', () =>
                c(Buffer.concat(buffers).toString('utf8') as FossilStdOut)
            );
        }),
        new Promise<FossilStdErr>(c => {
            const buffers: Buffer[] = [];
            on(child.stderr!, 'data', b => buffers.push(b));
            once(child.stderr!, 'close', () =>
                c(Buffer.concat(buffers).toString('utf8') as FossilStdErr)
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
    readonly stdout: FossilStdOut;
    readonly stderr: FossilStdErr;
    readonly exitCode: number;
    fossilErrorCode: FossilErrorCode;
    readonly args: FossilArgs;
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
    private readonly _onOutput = new EventEmitter<string>();
    get onOutput(): Event<string> {
        return this._onOutput.event;
    }

    constructor(options: IFossilOptions) {
        this.fossilPath = options.fossilPath;
        this.outputChannel = options.outputChannel;
        this.version = options.version;
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
                ![
                    'NoSuchFile',
                    'NotAFossilRepository',
                    'OperationMustBeForced',
                ].includes(err.fossilErrorCode) &&
                args[0] !== 'close' // 'close' always shows error as 'showWarningMessage'
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
                    /(not within an open check-?out|specify the repository database|cannot find current working directory)/.test(
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
    private logArgs(args: FossilArgs, reason: string, info: string): void {
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
