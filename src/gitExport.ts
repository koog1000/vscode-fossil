import {
    authentication,
    AuthenticationSession,
    Disposable,
    ProgressLocation,
    QuickPickItem,
    QuickPickItemKind,
    Uri,
    window,
} from 'vscode';
import { Octokit } from '@octokit/rest';
import { Repository } from './repository';
import { Distinct } from './openedRepository';
import { mkdir } from 'fs/promises';
import { RequestError } from '@octokit/request-error';

const GITHUB_AUTH_PROVIDER_ID = 'github';
// https://fossil-scm.org/home/doc/trunk/www/mirrortogithub.md says
// we should have `repo` scope
const SCOPES = ['repo'];

export class Credentials {
    private octokit: Octokit | undefined;
    public session: AuthenticationSession | undefined;
    private registered: boolean = false;

    /**
     * it is safe to initialize multiple times
     */
    async initialize(disposables: Disposable[]): Promise<void> {
        if (!this.registered) {
            disposables.push(
                authentication.onDidChangeSessions(async e => {
                    if (e.provider.id === GITHUB_AUTH_PROVIDER_ID) {
                        this.octokit = await this.tryCreateOctokit();
                    }
                })
            );
        }
        if (!this.octokit) {
            this.octokit = await this.tryCreateOctokit();
        }
    }

    private async tryCreateOctokit(
        createIfNone: boolean = false
    ): Promise<Octokit | undefined> {
        const session = (this.session = await authentication.getSession(
            GITHUB_AUTH_PROVIDER_ID,
            SCOPES,
            { createIfNone }
        ));

        return session
            ? new Octokit({
                  auth: session.accessToken,
              })
            : undefined;
    }

    async getOctokit(): Promise<Octokit> {
        if (this.octokit) {
            return this.octokit;
        }
        this.octokit = await this.tryCreateOctokit(true);
        return this.octokit!;
    }
}

type GitMirrorPath = Distinct<
    string,
    'path that goes as MIRROR option to `fossil export`'
>;
type AutoPushURIUnsafe = Distinct<
    Uri,
    'URL that goes as --autopush option to `fossil export`'
>;
type AutoPushURISafe = Distinct<
    Uri,
    'like `AutoPushURIUnsafe`, but without tokens`'
>;
type GitExportOptions = {
    path: GitMirrorPath;
    url: AutoPushURISafe;
    urlUnsafe: AutoPushURIUnsafe;
};
/**
 * this function will create github repository if necessary
 */
export async function inputExportOptions(
    credentials: Credentials,
    repository: Repository,
    disposables: Disposable[]
): Promise<GitExportOptions | undefined> {
    // ask: exportParentPath (hardest part, no explicit vscode API for this)
    let exportParentPath = await window.showSaveDialog({
        title:
            'Parent path for intermediate git repository ' +
            'outside of fossil repository',
        saveLabel: 'Select',
        filters: {
            Directories: [], // trying to select only directories
        },
    });

    if (!exportParentPath) {
        return;
    }
    if (exportParentPath.path.endsWith('.undefined')) {
        // somewhat vscode bug
        exportParentPath = exportParentPath.with({
            path: exportParentPath.path.slice(0, -10),
        });
    }

    // ask: repository name
    const config = await repository.config(
        'short-project-name',
        'project-name',
        'project-description'
    );
    const name = await window.showInputBox({
        prompt: 'The name of the new repository',
        ignoreFocusOut: true,
        value: config.get('short-project-name') || config.get('project-name'),
    });
    if (!name) {
        return;
    }

    // ask: where
    const toGithub = {
        label: '$(github) Export to github',
    };
    const toUrl = {
        label: '$(globe) Export using git url',
    };
    const where = await window.showQuickPick([toGithub, toUrl]);
    if (!where) {
        return;
    }

    const exportPath = Uri.joinPath(exportParentPath, name)
        .fsPath as GitMirrorPath;

    if (where === toUrl) {
        // ask URL
        const urlStr = await window.showInputBox({
            prompt: 'The URL of an empty repository',
            ignoreFocusOut: true,
        });
        if (urlStr) {
            const url = Uri.parse(urlStr);
            const safeAuthority = url.authority.substring(
                url.authority.indexOf('@')
            );
            return {
                path: exportPath,
                url: url.with({ authority: safeAuthority }) as AutoPushURISafe,
                urlUnsafe: url as AutoPushURIUnsafe,
            };
        }
        return;
    }

    // github option was chosen
    // so, we must authenticate
    await credentials.initialize(disposables);
    const octokit = await credentials.getOctokit();
    const userInfo = await octokit.users.getAuthenticated();
    const orgs = await octokit.orgs.listForAuthenticatedUser();

    // ask: organization (orgToUse)
    const userItem: QuickPickItem = {
        label: userInfo.data.login,
        description: userInfo.data.name || '',
        iconPath: Uri.parse(userInfo.data.avatar_url),
    };
    const items: QuickPickItem[] = [userItem];
    if (orgs.data.length) {
        items.push({
            label: 'Organizations',
            kind: QuickPickItemKind.Separator,
        });
        for (const item of orgs.data) {
            items.push({
                label: item.login,
                description: item.description ?? '',
                iconPath: Uri.parse(item.avatar_url),
            });
        }
    }
    const orgToUse = await window.showQuickPick(items, {
        title: 'The organization of the new repository',
    });
    if (!orgToUse) {
        return;
    }

    const description = await window.showInputBox({
        prompt: 'Description of the new repository',
        ignoreFocusOut: true,
        value: config.get('project-description'),
    });
    if (!description) {
        return;
    }

    // ask: privacy
    const publicItem: QuickPickItem = {
        label: '$(globe) Public',
    };
    const privateItem: QuickPickItem = {
        label: '$(lock) Private',
    };
    const selectedPrivacy = await window.showQuickPick(
        [privateItem, publicItem],
        {
            title: 'Privacy',
        }
    );
    if (!selectedPrivacy) {
        return;
    }
    // get repository url, maybe not all repos are in github.com domain
    const githubOptions = {
        name,
        description,
        private: selectedPrivacy === privateItem,
    };
    let response: { data: { html_url: string } };
    try {
        if (orgToUse === userItem) {
            response = await octokit.repos.createForAuthenticatedUser(
                githubOptions
            );
        } else {
            response = await octokit.repos.createInOrg({
                org: orgToUse.label,
                ...githubOptions,
            });
        }
    } catch (err) {
        if (err instanceof RequestError && err.response?.data) {
            const errMessage = (err.response.data as any)['message'];
            const errDescription = (
                (err.response.data as any)['errors'] as Error[]
            )
                .map(e => e.message)
                .join(', ');
            const ignore = 'Continue';
            const answer = await window.showErrorMessage(
                `${errMessage}:\n${errDescription}`,
                ignore
            );
            if (answer !== ignore) {
                return;
            }
            response = await octokit.repos.get({
                owner: orgToUse.label,
                repo: name,
            });
        } else {
            await window.showErrorMessage(
                `Failed to create github repository: ${err}`
            );
            return;
        }
    }
    // add token to url
    const session = credentials.session!;
    const remoteUri = Uri.parse(response.data.html_url) as AutoPushURISafe;
    const remoteUriWithToken = remoteUri.with({
        authority: `${session.account.label}:${session.accessToken}@${remoteUri.authority}`,
    }) as AutoPushURIUnsafe;

    return { path: exportPath, url: remoteUri, urlUnsafe: remoteUriWithToken };
}

export async function exportGit(
    options: GitExportOptions,
    repository: Repository
): Promise<void> {
    await window.withProgress(
        {
            title: `Creating $(github) repository ${options.url}`,
            location: ProgressLocation.Notification,
        },
        async (progress): Promise<any> => {
            progress.report({
                message: `Setting up fossil with ${options.url}`,
                increment: 33,
            });
            const terminal = window.createTerminal({
                name: 'Fossil git export',
                cwd: repository.root,
            });
            await mkdir(options.path, { recursive: true, mode: 0o700 });
            terminal.sendText(
                // space at the start to skip history
                ` fossil git export ${
                    options.path
                } --mainbranch main --autopush ${options.urlUnsafe.toString()}`
            );
            progress.report({
                message:
                    '$(terminal) running export (manually close the terminal to finish)',
                increment: 66,
            });
            await new Promise<void>(ready => {
                const dis = window.onDidCloseTerminal(closedTerminal => {
                    if (closedTerminal === terminal) {
                        progress.report({
                            message: 'done',
                            increment: 100,
                        });
                        ready();
                        dis.dispose();
                    }
                });
            });
        }
    );
}
