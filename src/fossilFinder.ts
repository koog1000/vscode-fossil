import * as cp from 'child_process';
import type { Distinct } from './openedRepository';
import type {
    FossilExecutablePath,
    FossilStdOut,
    FossilVersion,
} from './fossilExecutable';
import { localize } from './main';

export type UnvalidatedFossilExecutablePath = Distinct<
    string,
    'unvalidated fossil executable path' | 'fossil executable path'
>;

export interface FossilExecutableInfo {
    path: FossilExecutablePath;
    version: FossilVersion;
}

function getVersion(
    path: UnvalidatedFossilExecutablePath
): Promise<FossilStdOut> {
    return new Promise<FossilStdOut>((c, e) => {
        const buffers: Buffer[] = [];
        const child = cp.spawn(path, ['version']);
        child.stdout.on('data', (b: Buffer) => buffers.push(b));
        child.on('error', e);
        child.on('close', code => {
            if (!code) {
                return c(
                    Buffer.concat(buffers).toString('utf8') as FossilStdOut
                );
            }
            return e(new Error('Not found'));
        });
    });
}

export async function findFossil(
    hint: UnvalidatedFossilExecutablePath,
    logLine: (test: string) => void
): Promise<FossilExecutableInfo | undefined> {
    for (const [path, isHint] of [
        [hint, 1],
        ['fossil' as UnvalidatedFossilExecutablePath, 0],
    ] as const) {
        if (path.length) {
            let stdout: string;
            try {
                stdout = await getVersion(path);
            } catch (e: unknown) {
                logLine(
                    isHint
                        ? `\`fossil.path\` '${path}' is unavailable (${e}). Will try 'fossil' as the path`
                        : `'${path}' is unavailable (${e}). Fossil extension commands will be disabled`
                );
                continue;
            }

            const match = stdout.match(/version (.+)\[/);
            let version = [0] as FossilVersion;
            if (match) {
                version = match[1]
                    .split('.')
                    .map(s => parseInt(s)) as FossilVersion;
            } else {
                logLine(
                    `Failed to parse fossil version from output: '${stdout}'`
                );
            }

            logLine(
                localize(
                    'using fossil',
                    'Using fossil {0} from {1}',
                    version.join('.'),
                    path
                )
            );
            return {
                path: path as FossilExecutablePath,
                version: version,
            };
        }
    }
    return undefined;
}
