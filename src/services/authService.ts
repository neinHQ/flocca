import * as vscode from 'vscode';

export class AuthService {
    private static readonly STORED_SECRET_KEYS = [
        'flocca.atlassian.token',
        'flocca.slack.token',
        'flocca.gitlab.token',
        'flocca.bitbucket.password',
        'flocca.k8s.token',
        'flocca.azure.token',
        'flocca.testrail.key',
        'flocca.teams.token',
        'flocca.azure.cloud.token',
        'flocca.gcp.token',
        'flocca.elastic.auth',
        'flocca.obs.auth',
        'flocca.db.connection',
        'flocca.notion.token',
        'flocca.sentry.token',
        'flocca.figma.token'
    ];

    constructor(private context: vscode.ExtensionContext) { }

    async getGitHubToken(createIfNone: boolean = true, forceNewSession: boolean = false): Promise<string | undefined> {
        try {
            const options: vscode.AuthenticationGetSessionOptions = { createIfNone };
            if (forceNewSession) {
                options.forceNewSession = true;
                delete options.createIfNone;
            }

            const session = await vscode.authentication.getSession('github', ['repo', 'user:email'], options);
            if (session) {
                console.log('GitHub authentication successful.');
                return session.accessToken;
            }
        } catch (error) {
            // Only log error if we expected to create a session
            if (createIfNone) {
                console.error('GitHub authentication failed:', error);
                const errorMessage = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`GitHub authentication failed: ${errorMessage}`);
            }
        }
        return undefined;
    }

    async getAtlassianToken(): Promise<string | undefined> {
        // Retrieve token from secrets
        const token = await this.context.secrets.get('flocca.atlassian.token');
        return token;
    }

    async getSlackToken(): Promise<string | undefined> {
        return await this.context.secrets.get('flocca.slack.token');
    }

    async storeSlackToken(token: string) {
        await this.context.secrets.store('flocca.slack.token', token);
    }

    async storeAtlassianToken(token: string) {
        await this.context.secrets.store('flocca.atlassian.token', token);
    }

    async getGitLabToken(): Promise<string | undefined> {
        return await this.context.secrets.get('flocca.gitlab.token');
    }

    async storeGitLabToken(token: string) {
        await this.context.secrets.store('flocca.gitlab.token', token);
    }

    async getBitbucketPassword(): Promise<string | undefined> {
        return await this.context.secrets.get('flocca.bitbucket.password');
    }

    async storeBitbucketPassword(password: string) {
        await this.context.secrets.store('flocca.bitbucket.password', password);
    }

    async storeK8sToken(token: string) {
        await this.context.secrets.store('flocca.k8s.token', token);
    }

    async getK8sToken(): Promise<string | undefined> {
        return await this.context.secrets.get('flocca.k8s.token');
    }

    async storeAzureToken(token: string) {
        await this.context.secrets.store('flocca.azure.token', token);
    }

    async storeTestRailKey(key: string) {
        await this.context.secrets.store('flocca.testrail.key', key);
    }

    async storeTeamsToken(token: string) {
        await this.context.secrets.store('flocca.teams.token', token);
    }

    async storeAzureCloudToken(token: string) {
        await this.context.secrets.store('flocca.azure.cloud.token', token);
    }

    async storeGCPToken(token: string) {
        await this.context.secrets.store('flocca.gcp.token', token);
    }

    async storeElasticAuth(auth: string) {
        await this.context.secrets.store('flocca.elastic.auth', auth);
    }

    async storeObservabilityAuth(auth: string) {
        await this.context.secrets.store('flocca.obs.auth', auth);
    }

    async storeDBString(conn: string) {
        await this.context.secrets.store('flocca.db.connection', conn);
    }

    async storeNotionToken(token: string) {
        await this.context.secrets.store('flocca.notion.token', token);
    }

    async storeSentryToken(token: string) {
        await this.context.secrets.store('flocca.sentry.token', token);
    }

    async storeFigmaToken(token: string) {
        await this.context.secrets.store('flocca.figma.token', token);
    }

    async getFigmaToken(): Promise<string | undefined> {
        return await this.context.secrets.get('flocca.figma.token');
    }

    // --- Backend Auth ---

    // private static readonly API_BASE = 'http://localhost:3000'; // Moved to config.ts

    async login(email: string, password: string): Promise<{ user: any, token?: string } | null> {
        try {
            const { CONFIG } = require('../config');
            const res = await fetch(`${CONFIG.API_BASE}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            if (!res.ok) {
                const err = await res.json() as any;
                throw new Error(err.error || 'Login failed');
            }

            return await res.json() as any;
        } catch (e: any) {
            vscode.window.showErrorMessage(`Login Failed: ${e.message}`);
            return null;
        }
    }

    async register(email: string, password: string, anonymousId?: string): Promise<{ user: any } | null> {
        try {
            const { CONFIG } = require('../config');
            const res = await fetch(`${CONFIG.API_BASE}/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password, anonymousId })
            });

            if (!res.ok) {
                const err = await res.json() as any;
                throw new Error(err.error || 'Registration failed');
            }

            return await res.json() as any;
        } catch (e: any) {
            vscode.window.showErrorMessage(`Registration Failed: ${e.message}`);
            return null;
        }
    }

    async saveConnection(provider: string, payload: Record<string, any>, userId: string, teamId?: string): Promise<void> {
        try {
            const { CONFIG } = require('../config');
            const res = await fetch(`${CONFIG.API_BASE}/connect/${encodeURIComponent(provider)}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Flocca-Client': 'extension'
                },
                body: JSON.stringify({
                    ...payload,
                    state: userId,
                    teamId: teamId || undefined
                })
            });

            if (!res.ok) {
                const txt = await res.text();
                throw new Error(txt || `Failed to persist ${provider} connection`);
            }
        } catch (e) {
            console.error(`Failed to persist provider connection for ${provider}:`, e);
            throw e;
        }
    }

    async getConnectedProviders(userId: string): Promise<string[]> {
        try {
            const { CONFIG } = require('../config');
            const res = await fetch(`${CONFIG.API_BASE}/connections?userId=${encodeURIComponent(userId)}`);
            if (!res.ok) return [];

            const data = await res.json() as Record<string, { connected?: boolean } | boolean>;
            return Object.entries(data)
                .filter(([, value]) => {
                    if (typeof value === 'boolean') return value;
                    return !!value?.connected;
                })
                .map(([provider]) => provider);
        } catch (e) {
            console.error('Failed to fetch connected providers:', e);
            return [];
        }
    }

    async clearStoredSecrets() {
        for (const key of AuthService.STORED_SECRET_KEYS) {
            await this.context.secrets.delete(key);
        }
    }
}
