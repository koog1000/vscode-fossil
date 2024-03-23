import * as path from 'path';
import * as Mocha from 'mocha';
import * as fs from 'fs';

export function run(testsRoot: string): Promise<void> {
    // Create the mocha test
    const mocha = new Mocha({
        ui: 'tdd',
    });

    return new Promise((c, e) => {
        fs.readdir(testsRoot, { withFileTypes: true }, (err, files) => {
            /* c8 ignore next 3 */
            if (err) {
                return e(err);
            }

            // Add files to the test suite
            files
                .filter(f => f.isFile() && f.name.endsWith('.test.js'))
                .forEach(f => mocha.addFile(path.resolve(testsRoot, f.name)));

            try {
                // Run the mocha test
                mocha.run(failures => {
                    /* c8 ignore next 2 */
                    if (failures > 0) {
                        e(new Error(`${failures} tests failed.`));
                    } else {
                        c();
                    }
                });
                /* c8 ignore next 3 */
            } catch (err) {
                e(err);
            }
        });
    });
}
