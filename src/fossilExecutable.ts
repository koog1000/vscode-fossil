import type {
    AnyPath,
    Distinct,
    FossilBranch,
    FossilCheckin,
    FossilColor,
    FossilCommitMessage,
    FossilPath,
    FossilRemoteName,
    FossilRoot,
    FossilTag,
    FossilURI,
    FossilURIString,
    FossilUsername,
    RelativePath,
    StashID,
    UserPath,
} from './openedRepository';
import * as path from 'path';
import * as fs from 'fs/promises';
import { window, LogOutputChannel, ProgressLocation } from 'vscode';
import * as cp from 'child_process';
import { dispose, IDisposable, toDisposable } from './util';
import * as interaction from './interaction';
import type { FossilExecutableInfo } from './fossilFinder';

/** usually two numbers like [2,19] */
export type FossilVersion = Distinct<number[], 'fossil version'>;
export type FossilStdOut = Distinct<
    string,
    'raw fossil stdout' | 'fossil status stdout' | 'RenderedHTML'
>;
export type FossilStdErr = Distinct<string, 'raw fossil stderr'>;
/** Reason for executing a command */
export type Reason = Distinct<string, 'exec reason'> | undefined;
/** Title for `fossil wiki create` PAGENAME */
export type FossilWikiTitle = Distinct<string, 'Wiki TItle'>;
/** vscode.TestDocument.uri.fspath */
export type DocumentFsPath = Distinct<
    string,
    'vscode.TestDocument.uri.fspath.'
>;

export type FossilProjectName = Distinct<string, 'project name'>;
export type FossilProjectDescription = Distinct<string, 'project description'>;

/** cwd for executing fossil */
export type FossilCWD =
    | Distinct<string, 'cwd for executing fossil'>
    | FossilRoot;

export type FossilExecutablePath = Distinct<string, 'fossil executable path'>;

export interface FossilSpawnOptions extends cp.SpawnOptionsWithoutStdio {
    readonly cwd: FossilCWD;
    /**
     * Whether to log stderr to the fossil outputChannel and
     * whether to show message box with an error
     */
    readonly logErrors?: boolean;
    /** Supply data to stdin */
    readonly stdin_data?: string;
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

export type FossilArgs =
    | ['add', '--', ...RelativePath[]]
    | ['amend', FossilCheckin, '--comment', FossilCommitMessage]
    | ['branch', 'ls', '-t', ...(['-c'] | [])]
    | [
          'branch',
          'new',
          FossilBranch,
          'current',
          ...(['--private'] | []),
          ...(['--bgcolor', FossilColor] | [])
      ]
    | ['branch', 'current']
    | ['cat', ...(['-r', FossilCheckin] | []), '--', RelativePath]
    | ['cat'] // test only, command to test a failure
    | ['clean', ...DocumentFsPath[]]
    | ['clean', '--verbose'] // test only
    | ['clone', FossilURIString, FossilPath, '--verbose']
    | ['close']
    | [
          'commit',
          ...(['--user-override', FossilUsername] | []),
          ...(['--branch', FossilBranch] | []),
          ...(['--branchcolor', FossilColor] | []),
          ...(['--private'] | []),
          '-m',
          FossilCommitMessage,
          '--',
          ...RelativePath[]
      ]
    | [
          'commit',
          '-m',
          FossilCommitMessage,
          ...(['--branch', FossilBranch] | []),
          '--no-warnings'
      ] // test only
    | ['diff', '--json', DocumentFsPath]
    | ['forget', '--', ...RelativePath[]]
    | ['git', 'export']
    | ['sync']
    | [
          'info',
          ...([FossilCheckin] | []),
          ...(['--comment-format', '-wordbreak'] | [])
      ]
    | [
          'init',
          FossilPath,
          ...(['--project-name', FossilProjectName] | []),
          ...(['--project-desc', FossilProjectDescription] | [])
      ]
    | ['ls', ...DocumentFsPath[]]
    | [
          'merge',
          FossilCheckin,
          ...(['--cherrypick'] | []),
          ...(['--integrate'] | [])
      ]
    | ['mv', RelativePath, RelativePath, '--hard'] // test only
    | ['open', FossilPath, ...(['--force'] | [])]
    | ['patch', 'apply' | 'create', UserPath]
    | ['pikchr', ...(['-dark'] | [])]
    | ['praise', DocumentFsPath]
    | ['pull', FossilRemoteName]
    | ['push', FossilRemoteName]
    | ['push']
    | ['remote', 'list']
    | ['rename', AnyPath, RelativePath | UserPath]
    | ['revert', '--', ...RelativePath[]]
    | ['settings', 'allow-symlinks', 'on']
    | ['sqlite', '--readonly']
    | ['stash', 'drop' | 'apply', `${StashID}`]
    | [
          'stash',
          'save' | 'snapshot',
          '-m',
          FossilCommitMessage,
          ...RelativePath[]
      ]
    | ['stash', 'pop']
    | ['stash', 'list']
    | ['status', '--differ', '--merge']
    | ['tag', 'add', '--raw', FossilTag, FossilBranch]
    | ['tag', 'cancel', '--raw', FossilTag, FossilBranch]
    | ['tag', 'list']
    | [
          'test-markdown-render' | 'test-wiki-render',
          ...(['--dark-pikchr'] | []),
          '-'
      ]
    | [
          'timeline',
          ...(['before', FossilCheckin] | []),
          ...(['-n', `${number}`] | []),
          ...(['-p', RelativePath] | []),
          ...(['--verbose'] | []),
          '--type',
          'ci',
          '--format',
          '%H+++%d+++%b+++%a+++%c'
      ]
    | ['undo' | 'redo', ...(['--dry-run'] | [])]
    | ['update', ...([FossilCheckin] | []), ...(['--dry-run'] | [])]
    | [
          'wiki',
          'create',
          FossilWikiTitle,
          '--mimetype',
          'text/x-fossil-wiki' | 'text/x-markdown' | 'text/plain',
          ...(['--technote', 'now'] | [])
      ];

export type RawExecResult = FossilRawResult & {
    stdout: Buffer;
    stderr: Buffer;
};

export function toString(this: ExecFailure): string {
    // because https://github.com/github/codeql-action/issues/1230
    // we ignore `toString` in global `.eslintrc.json`
    const { message, toString, ...clone } = this;
    return message + ' ' + JSON.stringify(clone, null, 2);
}

export class FossilExecutable {
    private fossilPath!: FossilExecutablePath;
    public version!: FossilVersion;
    constructor(public readonly outputChannel: LogOutputChannel) {}

    setInfo(info: FossilExecutableInfo) {
        this.fossilPath = info.path;
        this.version = info.version;
    }

    async init(
        fossilRoot: FossilCWD,
        fossilPath: FossilPath,
        projectName: FossilProjectName | undefined, // since fossil 2.18
        projectDesc: FossilProjectDescription | undefined // since fossil 2.18
    ): Promise<void> {
        await this.exec(fossilRoot, [
            'init',
            fossilPath,
            ...(projectName
                ? (['--project-name', projectName] as const)
                : ([] as const)),
            ...(projectDesc
                ? (['--project-desc', projectDesc] as const)
                : ([] as const)),
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
        const res = await this._loggingExec(args, { cwd: fossilCwd });
        if (!res.exitCode) {
            return res.stdout;
        }
        return;
    }

    async rawExec(
        args: FossilArgs,
        options: FossilSpawnOptions
    ): Promise<RawExecResult> {
        options.stdio ??= 'pipe';

        options.env = {
            ...process.env,
            ...options.env,
            LC_ALL: 'en_US',
            LANG: 'en_US.UTF-8',
        };

        const child = cp.spawn(this.fossilPath, args, options);

        const disposables: IDisposable[] = [];

        const once = (
            ee: typeof child.stdout | typeof child,
            name: 'close' | 'error' | 'exit',
            fn: (...args: any[]) => void
        ) => {
            ee.once(name, fn);
            disposables.push(toDisposable(() => ee.removeListener(name, fn)));
        };

        const on = (
            ee: typeof child.stdout | typeof child,
            name: 'data',
            fn: (...args: any[]) => void
        ) => {
            ee.on(name, fn);
            disposables.push(toDisposable(() => ee.removeListener(name, fn)));
        };
        let readTimeout: ReturnType<typeof setTimeout> | undefined;
        const buffers: Buffer[] = [];

        async function onReadTimeout(): Promise<void> {
            if (!buffers.length) {
                return;
            }
            const stringThatMightBePrompt =
                buffers[buffers.length - 1].toString();
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

        return {
            fossilPath: this.fossilPath,
            exitCode,
            stdout,
            stderr,
            args,
            cwd: options.cwd,
        };
    }

    private async _loggingExec(
        args: FossilArgs,
        options: FossilSpawnOptions,
        reason?: Reason
    ) {
        const startTimeHR = process.hrtime();
        const waitAndLog = (timeout: number): ReturnType<typeof setTimeout> => {
            return setTimeout(() => {
                this.logArgs(args, 'still running', reason);
                logTimeout = waitAndLog(timeout * 4);
            }, timeout);
        };
        let logTimeout = waitAndLog(500);
        const resultRaw = await this.rawExec(args, options);
        clearTimeout(logTimeout);

        const durationHR = process.hrtime(startTimeHR);
        this.logArgs(
            args,
            `${Math.floor(msFromHighResTime(durationHR))}ms`,
            reason
        );
        return resultRaw;
    }

    public async exec(
        cwd: FossilCWD,
        args: FossilArgs,
        reason?: Reason,
        options: Omit<FossilSpawnOptions, 'cwd'> = {} as const
    ): Promise<ExecResult> {
        const resultRaw = await this._loggingExec(
            args,
            {
                cwd,
                ...options,
            },
            reason
        );
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
                this.outputChannel.error(
                    `(${args.join(', ')}): ${result.stderr}`
                );
            }
            const failure: ExecFailure = {
                ...result,
                message: 'Failed to execute fossil',
                fossilErrorCode,
                toString,
            };
            if (
                options.logErrors !== false &&
                fossilErrorCode == 'unknown' &&
                args[0] != 'close'
            ) {
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
        this.outputChannel.info(output);
    }
    private logArgs(args: FossilArgs, info: string, reason: Reason): void {
        if (args[0] == 'clone') {
            // replace password with 9 asterisks
            args = [...args];
            args[1] = args[1].replace(
                /(.*:\/\/.+:)(.+)(@.*)/,
                '$1*********$3'
            ) as FossilURIString;
        }
        this.log(
            `fossil ${args.join(' ')}: ${info}${reason ? ' // ' + reason : ''}`
        );
    }
}

function msFromHighResTime(hiResTime: [number, number]): number {
    const [seconds, nanoSeconds] = hiResTime;
    return seconds * 1e3 + nanoSeconds / 1e6;
}
