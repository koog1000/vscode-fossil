import {
    authentication,
    AuthenticationSession,
    commands,
    Disposable,
    QuickPickItemKind,
    Terminal,
    Uri,
    window,
} from 'vscode';
import * as sinon from 'sinon';
import { SinonStubT, fakeExecutionResult, getExecStub } from './common';
import * as assert from 'assert/strict';
import { Suite } from 'mocha';
import { Credentials } from '../../gitExport';
import { Octokit, RestEndpointMethodTypes } from '@octokit/rest';
import { promises } from 'fs';
import { RequestError } from '@octokit/request-error';

const useSpecified = { __sentinel: true } as const;

function getValue(
    value: string | undefined | typeof useSpecified,
    specified: string | undefined
): string | undefined {
    if (value == useSpecified) {
        return specified;
    }
    return value as string | undefined;
}

class GitExportTestHelper {
    public readonly sod: SinonStubT<typeof window.showOpenDialog>;
    public readonly sib: SinonStubT<typeof window.showInputBox>;
    public readonly sqp: SinonStubT<typeof window.showQuickPick>;
    public readonly execStub: ReturnType<typeof getExecStub>;
    public readonly fakeOctokit: ReturnType<
        typeof GitExportTestHelper.prototype.createFakeOctokit
    >;
    public readonly getSessionStub: SinonStubT<
        typeof authentication.getSession
    >;

    public readonly configJson = JSON.stringify([
        { name: 'short-project-name', value: 'spn' },
        { name: 'project-name', value: 'pn' },
        { name: 'project-description', value: 'pd' },
    ]);

    constructor(
        private readonly sandbox: sinon.SinonSandbox,
        options: {
            exportDirectory?: Uri[];
            repositoryName?: string | typeof useSpecified;
            destination?:
                | '$(github) Export to github'
                | '$(globe) Export using git url';
            organization?: 'testUser' | 'testOrg';
            repositoryDescription?: string | typeof useSpecified;
            private?: boolean;
            userName?: 'mr. Test';
            orgDescription?: 'the great';
            gitUrl?: string;
            configJson?: string;
            createForAuthenticatedUser?: 'valid' | 'already exists' | 'error';
        } = {}
    ) {
        options = {
            exportDirectory: [Uri.parse('file:///tmp/gitExport')],
            repositoryName: useSpecified,
            destination: '$(github) Export to github',
            repositoryDescription: useSpecified,
            organization: 'testUser',
            private: true,
            userName: 'mr. Test',
            orgDescription: 'the great',
            createForAuthenticatedUser: 'valid',
            ...options,
        };
        this.sod = sandbox
            .stub(window, 'showOpenDialog')
            .resolves(options.exportDirectory);
        this.execStub = getExecStub(sandbox)
            .withArgs(['sqlite', '--readonly'])
            .resolves(
                fakeExecutionResult({
                    stdout: options.configJson ?? this.configJson,
                })
            );
        this.sib = sandbox.stub(window, 'showInputBox');
        this.sib
            .withArgs(sinon.match({ prompt: 'The name of the new repository' }))
            .callsFake(o =>
                Promise.resolve(getValue(options.repositoryName, o!.value))
            );
        this.sib
            .withArgs(
                sinon.match({ prompt: 'Description of the new repository' })
            )
            .callsFake(o =>
                Promise.resolve(
                    getValue(options.repositoryDescription, o!.value)
                )
            );
        this.sib
            .withArgs(sinon.match({ prompt: 'The URL of an empty repository' }))
            .resolves(options.gitUrl);

        this.sqp = sandbox
            .stub(window, 'showQuickPick')
            .onFirstCall()
            .callsFake(items => {
                assert.ok(items instanceof Array);
                assert.equal(items.length, 2);
                assert.equal(items[0].label, '$(github) Export to github');
                assert.equal(items[1].label, '$(globe) Export using git url');
                return Promise.resolve(
                    items.find(v => v.label == options.destination)
                );
            })
            .onSecondCall()
            .callsFake(items => {
                assert.ok(items instanceof Array);
                assert.equal(items.length, 3);
                assert.equal(items[0].label, 'testUser');
                assert.equal(
                    items[0].description,
                    options.userName ? 'mr. Test' : ''
                );
                assert.equal(items[1].label, 'Organizations');
                assert.equal(items[1].kind, QuickPickItemKind.Separator);
                assert.equal(items[2].label, 'testOrg');
                assert.equal(
                    items[2].description,
                    options.orgDescription ? 'the great' : ''
                );

                return Promise.resolve(
                    items.find(v => v.label == options.organization)
                );
            })
            .onThirdCall()
            .callsFake(items => {
                assert.ok(items instanceof Array);
                assert.equal(items.length, 2);
                assert.equal(items[0].label, '$(lock) Private');
                assert.equal(items[1].label, '$(globe) Public');
                return Promise.resolve(
                    (() => {
                        switch (options.private) {
                            case true:
                                return items[0];
                            case false:
                                return items[1];
                        }
                        return;
                    })()
                );
            });

        const fakeSession: AuthenticationSession = {
            id: 'someId',
            accessToken: 'fakeAccessToken',
            scopes: ['repo'],
            account: {
                id: 'fakeHub',
                label: 'fakeAccountLabel',
            },
        };
        const tryCreateOctokitStub = sandbox.stub(
            Credentials.prototype,
            'tryCreateOctokit'
        );
        const fakeOctokit = (this.fakeOctokit = this.createFakeOctokit(
            options.userName,
            options.orgDescription,
            options.createForAuthenticatedUser!
        ));
        const getSessionStub = (this.getSessionStub = sandbox
            .stub(authentication, 'getSession')
            .resolves(fakeSession));
        const originalOctokit = tryCreateOctokitStub.callsFake(async function (
            this: Credentials
        ) {
            sinon.assert.notCalled(getSessionStub);
            const realOctoKitWithFakeToken =
                await originalOctokit.wrappedMethod.apply(this);
            sinon.assert.calledOnce(getSessionStub);

            sinon.assert.calledOnce(getSessionStub);
            if (realOctoKitWithFakeToken) {
                assert.equal(this.session, fakeSession);
                (this as any).octokit = fakeOctokit;
                return fakeOctokit as unknown as Octokit;
            } else {
                assert.ok(fakeSession);
            }
            return;
        });

        const getOctokitStub = sandbox
            .stub(Credentials.prototype, 'getOctokit')
            .callsFake(async function (this: Credentials) {
                const realOctoKitWithFakeToken =
                    await getOctokitStub.wrappedMethod.apply(this);
                assert.ok(realOctoKitWithFakeToken);
                return fakeOctokit as unknown as Octokit;
            });
    }

    fakeTerminal() {
        const fakeTerminal = {
            sendText: this.sandbox.stub(),
            show: this.sandbox.stub(),
        };
        fakeTerminal.show.callsFake(() => {
            const closeTerminalCb = odct.args[0][0];
            closeTerminalCb(fakeTerminal as unknown as Terminal);
        });
        this.sandbox
            .stub(window, 'createTerminal')
            .returns(fakeTerminal as unknown as Terminal);

        const fakeDisposable = this.sandbox.createStubInstance(Disposable);
        const odct = this.sandbox
            .stub(window, 'onDidCloseTerminal')
            .callsFake((): any => {
                return fakeDisposable;
            });
        const mkdir = this.sandbox.stub(promises, 'mkdir').resolves();
        return {
            fakeTerminal,
            fakeDisposable,
            odct,
            mkdir,
        };
    }

    stubShowErrorMessage() {
        return this.sandbox
            .stub(window, 'showErrorMessage')
            .resolves('Continue' as any);
    }

    private createFakeOctokit(
        userName: 'mr. Test' | undefined,
        orgDescription: 'the great' | undefined,
        createForAuthenticatedUser: 'valid' | 'already exists' | 'error'
    ) {
        const fakeOctokit = {
            users: {
                getAuthenticated: this.sandbox.stub().resolves({
                    data: {
                        login: 'testUser',
                        name: userName,
                        avatar_url: 'file://avatar.png',
                    },
                }),
            },
            orgs: {
                listForAuthenticatedUser: this.sandbox.stub().resolves({
                    data: [
                        {
                            login: 'testOrg',
                            description: orgDescription,
                            avatar_url: 'file://orgAvatar.png',
                        },
                    ],
                }),
            },
            repos: {
                createForAuthenticatedUser: this.sandbox.stub(),
                createInOrg: this.sandbox
                    .stub()
                    .callsFake(
                        async (
                            params: RestEndpointMethodTypes['repos']['createInOrg']['parameters']
                        ) => ({
                            data: {
                                html_url: `https://examplegit.com/${params.org}/${params.name}`,
                            },
                        })
                    ),
                get: this.sandbox
                    .stub()
                    .callsFake(
                        async (
                            params: RestEndpointMethodTypes['repos']['get']['parameters']
                        ) => ({
                            data: {
                                html_url: `https://examplegit.com/${params.owner}/${params.repo}`,
                            },
                        })
                    ),
            },
        };
        switch (createForAuthenticatedUser) {
            case 'valid':
                fakeOctokit.repos.createForAuthenticatedUser.callsFake(
                    async (
                        params: RestEndpointMethodTypes['repos']['createForAuthenticatedUser']['parameters']
                    ) => ({
                        data: {
                            html_url: `https://examplegit.com/${params.name}`,
                        },
                    })
                );
                break;
            case 'already exists':
                fakeOctokit.repos.createForAuthenticatedUser.rejects(
                    new RequestError('message', 401, {
                        response: {
                            data: {
                                message: 'already exists',
                                errors: [],
                            },
                            status: 100,
                            url: 'url',
                            headers: {},
                        },
                        request: {
                            headers: {},
                            method: 'POST',
                            url: 'url',
                        },
                    })
                );
                break;
            case 'error':
                fakeOctokit.repos.createForAuthenticatedUser.rejects(
                    new Error('connection error')
                );
                break;
        }
        return fakeOctokit;
    }
}

export function GetExportSuite(this: Suite): void {
    test('No session', async () => {
        // warning! must be first test
        const helper = new GitExportTestHelper(this.ctx.sandbox);
        helper.fakeTerminal();
        helper.getSessionStub.resolves(undefined);
        const sem = this.ctx.sandbox.stub(window, 'showErrorMessage');
        await commands.executeCommand('fossil.gitPublish');
        sinon.assert.calledOnce(helper.getSessionStub);
        sinon.assert.calledOnceWithMatch(
            sem,
            "No github session available, fossil won't export"
        );
    });

    test('Export to git (successful)', async () => {
        const execStub = getExecStub(this.ctx.sandbox);
        execStub.withArgs(['git', 'export']).resolves(fakeExecutionResult({}));
        await commands.executeCommand('fossil.gitExport');
        sinon.assert.calledOnce(execStub);
    });

    test('Publish repository to github by user as public', async () => {
        const helper = new GitExportTestHelper(this.ctx.sandbox);
        const term = helper.fakeTerminal();
        await commands.executeCommand('fossil.gitPublish');
        sinon.assert.calledThrice(helper.sqp);
        sinon.assert.calledOnce(term.mkdir);
        sinon.assert.calledOnce(term.odct);
        sinon.assert.calledOnce(term.fakeDisposable.dispose);
        sinon.assert.calledOnce(
            helper.fakeOctokit.repos.createForAuthenticatedUser
        );
    });

    test('Publish repository to git', async () => {
        const helper = new GitExportTestHelper(this.ctx.sandbox, {
            destination: '$(globe) Export using git url',
            gitUrl: 'https://user:password@example.com/git/test',
        });
        const term = helper.fakeTerminal();
        await commands.executeCommand('fossil.gitPublish');
        sinon.assert.calledOnce(helper.sqp);
        sinon.assert.calledOnce(term.mkdir);
        sinon.assert.calledOnce(term.odct);
        sinon.assert.calledOnce(term.fakeDisposable.dispose);
        sinon.assert.notCalled(
            helper.fakeOctokit.repos.createForAuthenticatedUser
        );
        const validateInput = helper.sib.firstCall.args[0]!['validateInput']!;
        assert.equal(validateInput(''), 'Must be a single word');
        assert.equal(validateInput('name'), '');
    });

    test('Publish repository to github by organization as private', async () => {
        const helper = new GitExportTestHelper(this.ctx.sandbox, {
            private: true,
            organization: 'testOrg',
            userName: undefined,
            orgDescription: undefined,
        });
        const term = helper.fakeTerminal();
        await commands.executeCommand('fossil.gitPublish');
        sinon.assert.calledThrice(helper.sqp);
        sinon.assert.calledOnce(term.mkdir);
        sinon.assert.calledOnce(term.odct);
        sinon.assert.calledOnce(term.fakeDisposable.dispose);
        sinon.assert.calledOnce(helper.fakeOctokit.repos.createInOrg);
    });

    test('Publish repository to github that already exists', async () => {
        const helper = new GitExportTestHelper(this.ctx.sandbox, {
            createForAuthenticatedUser: 'already exists',
        });
        const term = helper.fakeTerminal();
        const sem = helper.stubShowErrorMessage();
        await commands.executeCommand('fossil.gitPublish');
        sinon.assert.calledThrice(helper.sqp);
        sinon.assert.calledOnce(term.mkdir);
        sinon.assert.calledOnce(term.odct);
        sinon.assert.calledOnce(term.fakeDisposable.dispose);
        sinon.assert.calledOnce(
            helper.fakeOctokit.repos.createForAuthenticatedUser
        );
        sinon.assert.calledOnce(sem);
    });

    test('Publish repository to github that already exists (cancel)', async () => {
        this.ctx.sandbox.reset();
        const helper = new GitExportTestHelper(this.ctx.sandbox, {
            createForAuthenticatedUser: 'already exists',
        });
        const term = helper.fakeTerminal();
        const sem = helper.stubShowErrorMessage();
        sem.resolves(); // cancel action
        await commands.executeCommand('fossil.gitPublish');
        sinon.assert.calledOnce(
            helper.fakeOctokit.repos.createForAuthenticatedUser
        );
        sinon.assert.calledOnceWithMatch(sem, 'already exists:\n');
        sinon.assert.notCalled(term.mkdir);
        sinon.assert.notCalled(term.fakeTerminal.sendText);
    });

    test('Publish repository to github with unknown error', async () => {
        this.ctx.sandbox.reset();
        const helper = new GitExportTestHelper(this.ctx.sandbox, {
            createForAuthenticatedUser: 'error',
        });
        const term = helper.fakeTerminal();
        const sem = helper.stubShowErrorMessage();
        await commands.executeCommand('fossil.gitPublish');
        sinon.assert.calledOnce(
            helper.fakeOctokit.repos.createForAuthenticatedUser
        );
        sinon.assert.notCalled(term.fakeTerminal.sendText);
        sinon.assert.calledOnceWithMatch(
            sem,
            'Failed to create github repository: Error: connection error'
        );
    });

    test('Cancel export directory selection', async () => {
        const helper = new GitExportTestHelper(this.ctx.sandbox, {
            exportDirectory: undefined,
        });
        await commands.executeCommand('fossil.gitPublish');
        sinon.assert.calledOnce(helper.sod);
    });

    test('Cancel repository name', async () => {
        const helper = new GitExportTestHelper(this.ctx.sandbox, {
            repositoryName: undefined,
        });
        await commands.executeCommand('fossil.gitPublish');
        sinon.assert.calledOnce(helper.sod);
        sinon.assert.calledOnce(helper.sib);
    });

    test('Cancel export git url', async () => {
        const helper = new GitExportTestHelper(this.ctx.sandbox, {
            destination: '$(globe) Export using git url',
            gitUrl: undefined,
        });
        await commands.executeCommand('fossil.gitPublish');
        sinon.assert.calledOnce(helper.sod);
        sinon.assert.calledTwice(helper.sib);
    });

    test('Cancel destination (github/git)', async () => {
        const helper = new GitExportTestHelper(this.ctx.sandbox, {
            destination: undefined,
        });
        await commands.executeCommand('fossil.gitPublish');
        sinon.assert.calledOnce(helper.sod);
        sinon.assert.calledOnce(helper.sib);
        sinon.assert.calledOnce(helper.sqp);
    });

    test('Cancel organization (github/git)', async () => {
        const helper = new GitExportTestHelper(this.ctx.sandbox, {
            organization: undefined,
        });
        await commands.executeCommand('fossil.gitPublish');
        sinon.assert.calledOnce(helper.sod);
        sinon.assert.calledOnce(helper.sib);
        sinon.assert.calledTwice(helper.sqp);
    });

    test('Cancel description (github/git)', async () => {
        const helper = new GitExportTestHelper(this.ctx.sandbox, {
            repositoryDescription: undefined,
        });
        await commands.executeCommand('fossil.gitPublish');
        sinon.assert.calledOnce(helper.sod);
        sinon.assert.calledTwice(helper.sib);
        sinon.assert.calledTwice(helper.sqp);
    });

    test('Cancel private (github/git)', async () => {
        const helper = new GitExportTestHelper(this.ctx.sandbox, {
            private: undefined,
        });
        await commands.executeCommand('fossil.gitPublish');
        sinon.assert.calledOnce(helper.sod);
        sinon.assert.calledTwice(helper.sib);
        sinon.assert.calledThrice(helper.sqp);
    });

    test('Full project name can be used', async () => {
        const helper = new GitExportTestHelper(this.ctx.sandbox, {
            repositoryName: undefined,
            configJson: JSON.stringify([{ name: 'project-name', value: 'pn' }]),
        });
        await commands.executeCommand('fossil.gitPublish');
        sinon.assert.calledOnceWithMatch(helper.sib, { value: 'pn' });
    });
}
