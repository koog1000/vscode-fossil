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

function addDetails(a: Details, b: Details): Details {
    const total = a.total + b.total;
    const covered = a.covered + b.covered;

    return {
        total,
        covered,
        skipped: a.skipped + b.skipped,
        pct: parseFloat(((covered / total) * 100).toFixed(2)),
    };
}

function filterSummary(summary: Summary, predicate: (key: string) => boolean) {
    const entries = Object.entries(summary);
    const filtered = entries.filter(
        ([key, _info]) => key !== 'total' && predicate(key)
    );
    return Object.fromEntries(filtered);
}

function calcTotal(summary: Summary): Info {
    let branches: Details = { covered: 0, pct: 0, skipped: 0, total: 0 };
    let lines: Details = { covered: 0, pct: 0, skipped: 0, total: 0 };
    let statements: Details = { covered: 0, pct: 0, skipped: 0, total: 0 };
    let functions: Details = { covered: 0, pct: 0, skipped: 0, total: 0 };
    for (const info of Object.values(summary)) {
        branches = addDetails(branches, info.branches);
        lines = addDetails(lines, info.lines);
        statements = addDetails(statements, info.statements);
        functions = addDetails(functions, info.functions);
    }
    return {
        branches,
        lines,
        statements,
        functions,
    };
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

function writeSummary(summary: Summary): string {
    const lines: string[] = [];
    lines.push('|File|🙈 Lines|🙉 Branches|🙊 Functions|');
    lines.push('|-|-|-|-|');
    const total = calcTotal(filterSummary(summary, Boolean));
    lines.push(
        `|total|${formatDetails(total.lines)}|${formatDetails(
            total.branches
        )}|${formatDetails(total.functions)}|`
    );
    for (const [key, info] of Object.entries(summary)) {
        const split = key.indexOf('/src/');
        const normalized = split == -1 ? key : key.slice(split + 1);
        lines.push(
            `|${normalized}|${formatDetails(info.lines)}|${formatDetails(
                info.branches
            )}|${formatDetails(info.functions)}|`
        );
    }
    return lines.join('\n');
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
    lines.push('### Code\n');
    lines.push(
        writeSummary(
            filterSummary(obj as Summary, key => key.indexOf('src/test') == -1)
        )
    );
    lines.push('\n### Test\n');
    lines.push(
        writeSummary(
            filterSummary(obj as Summary, key => key.indexOf('src/test') != -1)
        )
    );
    lines.push('');

    const out = lines.join('\n');
    if (dstPath) {
        await fs.writeFile(dstPath, out);
    } else {
        process.stdout.write(out);
    }
    return 0;
}
main(...process.argv.slice(2))
    .then(code => process.exit(code))
    .catch(reason => {
        console.log(reason);
        process.exit(1);
    });
