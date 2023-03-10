import { workspace } from 'vscode';
import { FossilUsername } from './fossilBase';
import { UnvalidatedFossilExecutablePath } from './fossilFinder';

interface ConfigScheme {
    enabled: boolean;
    path: UnvalidatedFossilExecutablePath | null;
    autoInOutInterval: number;
    username: FossilUsername | null;
    autoUpdate: boolean;
    autoRefresh: boolean;
}

class Config {
    private get config() {
        return workspace.getConfiguration('fossil');
    }

    private get<TName extends keyof ConfigScheme>(
        name: TName
    ): ConfigScheme[TName] {
        // for keys existing in packages.json this function
        // will not return `undefined`
        return this.config.get<ConfigScheme[TName]>(
            name
        ) as ConfigScheme[TName];
    }

    /**
     * This flag should be removed. It exists because there's no way to
     * disable `git` internal extension in vscode using extensions UI
     * and this code is a fork of internal extension.
     */
    get enabled(): boolean {
        return this.get('enabled');
    }

    get path(): UnvalidatedFossilExecutablePath | null {
        return this.get('path');
    }

    /**
     * Enables automatic update of working directory to branch head
     * after pulling (equivalent to fossil update)
     */
    get autoUpdate(): boolean {
        return this.get('autoUpdate');
    }

    /**
     * Enables automatic refreshing of Source Control tab and badge
     * counter when files within the project change.
     */
    get autoRefresh(): boolean {
        return this.get('autoRefresh');
    }

    get autoInOutIntervalMs(): number {
        return this.get('autoInOutInterval') * 1000;
    }

    /**
     * * Specifies an explicit user to use for fossil commits.
     * * This should only be used if the user is different
     *   than the fossil default user.
     */
    get username(): FossilUsername | null {
        return this.get('username');
    }
}

const typedConfig = new Config();
export default typedConfig;
