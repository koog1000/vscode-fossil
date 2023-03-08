import { workspace } from 'vscode';
import { FossilUsername } from './fossilBase';

const DEFAULT_AUTO_IN_OUT_INTERVAL_SECONDS = 3 * 60; /* three minutes */

interface ConfigScheme {
    enabled: boolean;
    path?: string;
    autoInOutInterval: number;
    username?: FossilUsername;
    autoUpdate: boolean;
    autoRefresh: boolean;
}

class Config {
    private get config() {
        return workspace.getConfiguration('fossil');
    }

    private get<TName extends keyof ConfigScheme>(
        name: TName,
        defaultValue: ConfigScheme[TName]
    ) {
        return this.config.get(name, defaultValue);
    }

    get enabled(): boolean {
        return this.get('enabled', true);
    }

    get path(): string | undefined {
        return this.get('path', undefined);
    }

    /**
     * Enables automatic update of working directory to branch head
     * after pulling (equivalent to fossil update)
     */
    get autoUpdate(): boolean {
        return this.get('autoUpdate', true);
    }

    /**
     * Enables automatic refreshing of Source Control tab and badge
     * counter when files within the project change.
     */
    get autoRefresh(): boolean {
        return this.get('autoRefresh', true);
    }

    get autoInOutIntervalMs(): number {
        return (
            this.get(
                'autoInOutInterval',
                DEFAULT_AUTO_IN_OUT_INTERVAL_SECONDS
            ) * 1000
        );
    }

    /**
     * * Specifies an explicit user to use for fossil commits.
     * * This should only be used if the user is different
     *   than the fossil default user.
     */
    get username(): FossilUsername | undefined {
        return this.get('username', undefined);
    }
}

const typedConfig = new Config();
export default typedConfig;
