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

interface FossilRawResult {
    readonly fossilPath: FossilExecutablePath;
    readonly exitCode: 0 | 1 | Inline.ENOENT;
    readonly args: FossilArgs;
    readonly cwd: FossilCWD;
}

interface BaseFossilResult extends FossilRawResult {
    readonly fossilPath: FossilExecutablePath;
    readonly exitCode: 0 | 1 | Inline.ENOENT;
    readonly stdout: FossilStdOut;
    readonly stderr: FossilStdErr;
    readonly args: FossilArgs;
    readonly cwd: FossilCWD;
}

interface ExecSuccess extends BaseFossilResult {
    readonly exitCode: 0;
}

export interface ExecFailure extends BaseFossilResult {
    readonly exitCode: 1 | Inline.ENOENT; // use `1` as NonZero type
    readonly message: string;
    readonly fossilErrorCode: FossilErrorCode;
    toString(): string;
}

export type ExecResult = ExecSuccess | ExecFailure;

export type FossilErrorCode =
    | 'NotAFossilRepository' // not within an open check-?out
    | 'NoSuchFile'
    | 'BranchAlreadyExists'
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
    | 'remote'
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
type RawExecResult = FossilRawResult & { stdout: Buffer; stderr: Buffer };

async function rawExec(
    fossilPath: FossilExecutablePath,
    args: FossilArgs,
    options: FossilSpawnOptions
): Promise<RawExecResult> {
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
    let readTimeout: NodeJS.Timeout | undefined;
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
        new Promise<0 | 1 | Inline.ENOENT>((c, e) => {
            once(child, 'error', e);
            once(child, 'exit', c);
        }).catch((e: NodeJS.ErrnoException) => {
            if (e.code === 'ENOENT') {
                // most likely cwd was deleted
                return Inline.ENOENT;
            }
            throw e;
        }),
        new Promise<Buffer>(c => {
            function pushBuffer(buffer: Buffer) {
                buffers.push(buffer);
                if (checkForPrompt) {
                    clearTimeout(readTimeout);
                    readTimeout = setTimeout(() => onReadTimeout(), 50);
                }
            }
            on(child.stdout!, 'data', b => pushBuffer(b));
            once(child.stdout!, 'close', () => c(Buffer.concat(buffers)));
        }),
        new Promise<Buffer>(c => {
            const buffers: Buffer[] = [];
            on(child.stderr!, 'data', b => buffers.push(b));
            once(child.stderr!, 'close', () => c(Buffer.concat(buffers)));
        }),
    ]);
    clearTimeout(readTimeout);

    dispose(disposables);

    return { fossilPath, exitCode, stdout, stderr, args, cwd: options.cwd };
}

export function toString(this: ExecFailure): string {
    // because https://github.com/github/codeql-action/issues/1230
    // we ignore `toString` in global `.eslintrc.json`
    const { message, toString, ...clone } = this;
    return message + ' ' + JSON.stringify(clone, null, 2);
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
    ): Promise<ExecResult> {
        return this.exec(fossilCwd, ['open', fossilPath]);
    }

    async openCloneForce(
        fossilPath: FossilPath,
        fossilCwd: FossilCWD
    ): Promise<void> {
        await this.exec(fossilCwd, ['open', fossilPath, '--force']);
    }

    async cat(
        fossilCwd: FossilCWD,
        args: FossilArgs
    ): Promise<Buffer | undefined> {
        const res = await this._loggingExec(args, '', { cwd: fossilCwd });
        if (!res.exitCode) {
            return res.stdout;
        }
        return;
    }

    private async _loggingExec(
        args: FossilArgs,
        reason: string,
        options: FossilSpawnOptions
    ) {
        const startTimeHR = process.hrtime();
        const waitAndLog = (timeout: number): NodeJS.Timeout => {
            return setTimeout(() => {
                this.logArgs(args, reason, 'still running');
                logTimeout = waitAndLog(timeout * 4);
            }, timeout);
        };
        let logTimeout = waitAndLog(500);
        const resultRaw = await rawExec(this.fossilPath, args, options);
        clearTimeout(logTimeout);

        const durationHR = process.hrtime(startTimeHR);
        this.logArgs(
            args,
            reason,
            `${Math.floor(msFromHighResTime(durationHR))}ms`
        );
        return resultRaw;
    }

    public async exec(
        cwd: FossilCWD,
        args: FossilArgs,
        reason = '',
        options: Omit<FossilSpawnOptions, 'cwd'> = {} as const
    ): Promise<ExecResult> {
        const resultRaw = await this._loggingExec(args, reason, {
            cwd,
            ...options,
        });
        const result: ExecResult = {
            ...resultRaw,
            stdout: resultRaw.stdout.toString('utf8') as FossilStdOut,
            stderr: resultRaw.stderr.toString('utf8') as FossilStdErr,
        } as ExecResult;

        if (result.exitCode) {
            const fossilErrorCode: FossilErrorCode = (() => {
                if (
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
                } else if (
                    /^(a branch of the same name|an open branch named ".*"|branch ".*") already exists/.test(
                        result.stderr
                    )
                ) {
                    return 'BranchAlreadyExists';
                }
                return 'unknown';
            })();

            if (options.logErrors !== false && result.stderr) {
                this.log(`${result.stderr}\n`);
            }
            const failure: ExecFailure = {
                ...result,
                message: 'Failed to execute fossil',
                fossilErrorCode,
                toString,
            };
            if (fossilErrorCode == 'unknown' && args[0] != 'close') {
                const openLog = await interaction.errorPromptOpenLog(result);
                if (openLog) {
                    this.outputChannel.show();
                }
            }
            return failure;
        }
        return result as ExecSuccess;
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
