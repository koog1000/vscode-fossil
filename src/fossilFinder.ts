import * as cp from 'child_process';
import { OutputChannel } from 'vscode';
import { Distinct } from './fossilBase';
import {
    FossilExecutable,
    FossilExecutablePath,
    FossilVersion,
} from './fossilExecutable';
import { localize } from './main';

export type UnvalidatedFossilExecutablePath = Distinct<
    string,
    'unvalidated fossil executable path' | 'fossil executable path'
>;

interface FossilInfo {
    path: FossilExecutablePath;
    version: FossilVersion;
}

export async function findFossil(
    pathHint: UnvalidatedFossilExecutablePath | null,
    outputChannel: OutputChannel
): Promise<FossilExecutable> {
    const finder = new FossilFinder(outputChannel.appendLine);
    const info = await finder.find(pathHint);
    outputChannel.appendLine(
        localize(
            'using fossil',
            'Using fossil {0} from {1}',
            info.version.join('.'),
            info.path
        )
    );
    return new FossilExecutable({
        fossilPath: info.path,
        version: info.version,
        outputChannel: outputChannel,
    });
}

/**
 * FossilFinder must:
 *   1. Try to validate user specified path and return on success.
 *   2. Warn the user that the user setting is invalid.
 *   3. Try 'fossil' as fossil and return on success
 *   4. Raise exception
 *
 * We should ask the user about the path further down the line
 */
class FossilFinder {
    constructor(private readonly log: (line: string) => void) {}

    public async find(
        hint: UnvalidatedFossilExecutablePath | null
    ): Promise<FossilInfo> {
        if (hint) {
            try {
                return await this.validate(hint);
            } catch (e: unknown) {
                this.log(
                    `\`fossil.path\` '${hint}' is unavailable (${e}). Will try 'fossil' as the path`
                );
            }
        }
        return this.validate('fossil' as UnvalidatedFossilExecutablePath);
    }

    private parseVersion(raw: string): FossilVersion {
        const match = raw.match(/version (.+)\[/);
        if (match) {
            return match[1].split('.').map(s => parseInt(s)) as FossilVersion;
        }
        this.log(`Failed to parse fossil version from output: '${raw}'`);
        return [0] as FossilVersion;
    }

    private validate(
        path: UnvalidatedFossilExecutablePath
    ): Promise<FossilInfo> {
        return new Promise<FossilInfo>((c, e) => {
            const buffers: Buffer[] = [];
            const child = cp.spawn(path, ['version']);
            child.stdout.on('data', (b: Buffer) => buffers.push(b));
            child.on('error', e);
            child.on('close', code => {
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
