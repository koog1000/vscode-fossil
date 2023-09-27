import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

import { runTests } from '@vscode/test-electron';

async function main() {
    try {
        // The folder containing the Extension Manifest package.json
        // Passed to `--extensionDevelopmentPath`
        const extensionDevelopmentPath = path.resolve(__dirname, '../../');

        // The path to the extension test runner script
        // Passed to --extensionTestsPath
        const extensionTestsPath = path.resolve(__dirname, './suite/index');

        const testWorkspace = path.resolve(os.tmpdir(), './test_repo');
        await fs.mkdir(testWorkspace, { recursive: true });
        console.log(`testWorkspace: '${testWorkspace}'`);
        console.log(`extensionDevelopmentPath: '${extensionDevelopmentPath}'`);

        // Download VS Code, unzip it and run the integration test
        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [testWorkspace, '--disable-extensions'],
            // Fix version to stop tests failing as time goes by. See:
            // https://github.com/microsoft/vscode-test/issues/221
            version: '1.79.2',
        });
        /* c8 ignore next 4 */
    } catch (err) {
        console.error('Failed to run tests', err);
        process.exit(1);
    }
}

main();
