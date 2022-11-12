import { workspace } from 'vscode';

const DEFAULT_AUTO_IN_OUT_INTERVAL_SECONDS = 3 * 60; /* three minutes */

class Config {
    private get config() {
        return workspace.getConfiguration('fossil');
    }

    private get<T>(name: keyof Config, defaultValue: T): T {
        return this.config.get<T>(name, defaultValue);
    }

    get enabled(): boolean {
        return this.get('enabled', true);
    }

    get path(): string | undefined {
        return this.get('path', undefined);
    }

    get autoUpdate(): boolean {
        return this.get('autoUpdate', true);
    }

    get autoRefresh(): boolean {
        return this.get('autoRefresh', true);
    }

    get autoInOutInterval(): number {
        return this.get(
            'autoInOutInterval',
            DEFAULT_AUTO_IN_OUT_INTERVAL_SECONDS
        );
    }

    get autoInOutIntervalMs(): number {
        return this.autoInOutInterval * 1000;
    }

    get username(): string | undefined {
        return this.get('username', undefined);
    }
}

const typedConfig = new Config();
export default typedConfig;
