import { workspace } from 'vscode';
import type { FossilUsername } from './openedRepository';
import type { UnvalidatedFossilExecutablePath } from './fossilFinder';

interface ConfigScheme {
    ignoreMissingFossilWarning: boolean;
    path: UnvalidatedFossilExecutablePath;
    autoInOutInterval: number;
    username: FossilUsername; // must be ignored when empty
    autoRefresh: boolean;
    enableRenaming: boolean;
    confirmGitExport: 'Automatically' | 'Never' | null;
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

    get autoInOutIntervalMs(): number {
        return this.get('autoInOutInterval') * 1000;
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
}

const typedConfig = new Config();
export default typedConfig;
