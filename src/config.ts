import { workspace } from 'vscode';
import type { FossilUsername, Distinct } from './openedRepository';
import type { UnvalidatedFossilExecutablePath } from './fossilFinder';

export type AutoSyncIntervalMs = Distinct<number, 'AutoSyncIntervalMs'>;

interface ConfigScheme {
    ignoreMissingFossilWarning: boolean;
    path: UnvalidatedFossilExecutablePath;
    autoSyncInterval: number;
    username: FossilUsername; // must be ignored when empty
    autoRefresh: boolean;
    enableRenaming: boolean;
    confirmGitExport: 'Automatically' | 'Never' | null;
    globalArgs: string[];
    commitArgs: string[];
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
        return this.config.get<ConfigScheme[TName]>(name)!;
    }

    get path(): UnvalidatedFossilExecutablePath {
        return this.get('path').trim() as UnvalidatedFossilExecutablePath;
    }

    /**
     * Enables automatic refreshing of Source Control tab and badge
     * counter when files within the project change.
     */
    get autoRefresh(): boolean {
        return this.get('autoRefresh');
    }

    get autoSyncIntervalMs(): AutoSyncIntervalMs {
        return (this.get('autoSyncInterval') * 1000) as AutoSyncIntervalMs;
    }

    get enableRenaming(): boolean {
        return this.get('enableRenaming');
    }

    get ignoreMissingFossilWarning(): boolean {
        return this.get('ignoreMissingFossilWarning');
    }

    disableMissingFossilWarning() {
        return this.config.update('ignoreMissingFossilWarning', true, false);
    }

    /**
     * * Specifies an explicit user to use for fossil commits.
     * * This should only be used if the user is different
     *   than the fossil default user.
     */
    get username(): FossilUsername {
        return this.get('username');
    }

    disableRenaming() {
        return this.config.update('enableRenaming', false, false);
    }

    setGitExport(how: NonNullable<ConfigScheme['confirmGitExport']>) {
        return this.config.update('confirmGitExport', how, false);
    }

    get gitExport() {
        return this.get('confirmGitExport');
    }

    get globalArgs() {
        return this.get('globalArgs');
    }
    get commitArgs() {
        return this.get('commitArgs');
    }
}

const typedConfig = new Config();
export default typedConfig;
