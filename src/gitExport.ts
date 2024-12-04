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
import { mkdir } from 'fs/promises';
import { Octokit } from '@octokit/rest';
import { RequestError } from '@octokit/request-error';
import type { Repository } from './repository';
import type { Distinct } from './openedRepository';

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
            authentication.onDidChangeSessions(async e => {
                if (e.provider.id === GITHUB_AUTH_PROVIDER_ID) {
                    await this.tryCreateOctokit();
                }
            }, disposables);
        }
        if (!this.octokit) {
            await this.tryCreateOctokit();
        }
    }

    /** @internal */ async tryCreateOctokit(
        createIfNone: boolean = false
    ): Promise<Octokit | undefined> {
        const session = await authentication.getSession(
            GITHUB_AUTH_PROVIDER_ID,
            SCOPES,
            { createIfNone }
        );
        if (session) {
            this.octokit = new Octokit({
                auth: session.accessToken,
            });
            this.session = session;
            return this.octokit;
        }
        return;
    }

    async getOctokit(): Promise<Octokit> {
        return this.octokit ?? (await this.tryCreateOctokit(true))!;
    }
}

type GitMirrorPath = Distinct<
    string,
    'path that goes as MIRROR option to `fossil export`'
>;
type AutoPushURIUnsafe = Distinct<
    string,
    'URL that goes as --autopush option to `fossil export`'
>;
type AutoPushURISafe = Distinct<
    string,
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
    const exportParentPath = (
        await window.showOpenDialog({
            title:
                'Parent path for intermediate git repository ' +
                'outside of fossil repository',
            openLabel: 'Select',
            canSelectFiles: false,
            canSelectFolders: true,
        })
    )?.at(0);

    if (!exportParentPath) {
        return;
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
        validateInput: text =>
            /^\w+$/.test(text) ? '' : 'Must be a single word',
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
        const urlStr = (await window.showInputBox({
            prompt: 'The URL of an empty repository',
            ignoreFocusOut: true,
        })) as AutoPushURIUnsafe;
        if (urlStr) {
            const url = Uri.parse(urlStr);
            const safeUrl = url
                .with({
                    authority: url.authority.substring(
                        url.authority.indexOf('@')
                    ),
                })
                .toString() as AutoPushURISafe;
            return {
                path: exportPath,
                url: safeUrl,
                urlUnsafe: urlStr,
            };
        }
        return;
    }

    // github option was chosen
    // so, we must authenticate
    await credentials.initialize(disposables);
    const session = credentials.session;
    if (!session) {
        await window.showErrorMessage(
            `No github session available, fossil won't export ${(
                credentials as any
            ).octokit!}`
        );
        return;
    }

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
    const privateItem: QuickPickItem = {
        label: '$(lock) Private',
    };
    const publicItem: QuickPickItem = {
        label: '$(globe) Public',
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
    type Response =
        | Awaited<ReturnType<typeof octokit.repos.createForAuthenticatedUser>>
        | Awaited<ReturnType<typeof octokit.repos.createInOrg>>
        | Awaited<ReturnType<typeof octokit.repos.get>>;
    let response: Response;
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

    // ask: auth
    const withToken = {
        label: '$(github) Use https url with token',
    };
    const withGit = {
        label: '$(key) Use ssh url without token',
    };
    const auth = await window.showQuickPick([withToken, withGit]);
    if (!auth) {
        return;
    }

    let url: AutoPushURISafe;
    let urlUnsafe: AutoPushURIUnsafe;
    if (auth === withToken) {
        // add token to url
        url = response.data.html_url as AutoPushURISafe;
        const urlParsed = Uri.parse(url);
        urlUnsafe = urlParsed
            .with({
                authority: `${session.account.label}:${session.accessToken}@${urlParsed.authority}`,
            })
            .toString() as AutoPushURIUnsafe;
    } else {
        urlUnsafe = (url = response.data
            .ssh_url as AutoPushURISafe) as unknown as AutoPushURIUnsafe;
    }
    return { path: exportPath, url, urlUnsafe };
}

export async function exportGit(
    options: GitExportOptions,
    repository: Repository
): Promise<void> {
    await window.withProgress(
        {
            title: `Exporting git repository ${options.url}`,
            location: ProgressLocation.Notification,
        },
        async (progress): Promise<void> => {
            progress.report({
                message: `Setting up fossil with ${options.url}`,
                increment: 33,
            });
            const terminal = window.createTerminal({
                name: 'Fossil git export',
                cwd: repository.root,
            });
            const terminalIsClosed = new Promise<void>(ready => {
                const dis = window.onDidCloseTerminal(closedTerminal => {
                    if (closedTerminal === terminal) {
                        dis.dispose();
                        ready();
                    }
                });
            });
            await mkdir(options.path, { recursive: true, mode: 0o700 });
            terminal.sendText(
                // space at the start to skip history
                ` fossil git export ${
                    options.path
                } --mainbranch main --autopush ${options.urlUnsafe.toString()}`
            );
            terminal.show();
            progress.report({
                message:
                    'Running export (manually close the terminal to finish)',
                increment: 66,
            });
            await terminalIsClosed;
            progress.report({
                message: 'done',
                increment: 100,
            });
        }
    );
}
