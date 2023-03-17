//import * as data from '../coverage/coverage-summary.json';

import * as fs from 'fs/promises';

interface Details {
    total: number;
    covered: number;
    skipped: number;
    pct: number;
}
interface Info {
    lines: Details;
    statements: Details;
    functions: Details;
    branches: Details;
    branchesTrue?: Details; // total only
}

interface Summary {
    [key: string]: Info;
}

function formatDetails(details: Details): string {
    if (!details) {
        return '?';
    }
    const mark = (() => {
        if (details.pct < 66.0) return '🟥';
        else if (details.pct != 100.0) return '🟨';
        else return '🟩';
    })();
    return `${mark} ${details.pct}% (${details.covered}/${details.total})`;
}

async function main(
    srcPath = 'coverage/coverage-summary.json',
    dstPath?: string
): Promise<number> {
    const raw = await fs.readFile(srcPath);
    const obj: unknown = JSON.parse(raw.toString('utf-8'));
    if (!(obj instanceof Object)) {
        console.log('not an object', Object.prototype.toString.call(obj));
        return 1;
    }
    const lines: string[] = [];
    lines.push('|File|🙈 Lines|🙉 Branches|🙊 Functions|');
    lines.push('|-|-|-|-|');
    for (const [key, info] of Object.entries(obj as Summary)) {
        const split = key.indexOf('/src/');
        const normalized = split == -1 ? key : key.slice(split + 1);
        lines.push(
            `|${normalized}|${formatDetails(info.lines)}|${formatDetails(
                info.branches
            )}|${formatDetails(info.functions)}|`
        );
    }
    lines.push('');
    const out = lines.join('\n');
    if (dstPath) {
        await fs.writeFile(dstPath, out);
    } else {
        process.stdout.write(out);
    }
    return 0;
}
main(...process.argv.slice(2)).then(code => process.exit(code));
