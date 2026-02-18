import * as vscode from 'vscode';
import { McpClientManager } from '../services/mcpClientService';
import { SubscriptionService } from '../services/subscriptionService';
import { ServerRegistryService } from '../services/serverRegistryService';
import { AuthService } from '../services/authService';
import { TeamService } from '../services/teamService';
import { McpConfigService } from '../services/mcpConfigService';
import { CONFIG } from '../config';

type ProxyRestoreDef = {
    serverName: string;
    runtime: 'node' | 'python3';
    serverPath: string;
    proxyProvider?: string;
};

export class DashboardProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'flocca-chat';
    private static readonly PROXY_RESTORE_MAP: Record<string, ProxyRestoreDef> = {
        github: { serverName: 'github', runtime: 'node', serverPath: 'resources/servers/github/server.js' },
        jira: { serverName: 'jira', runtime: 'node', serverPath: 'resources/servers/jira/server.js' },
        confluence: { serverName: 'confluence', runtime: 'node', serverPath: 'resources/servers/confluence/server.js' },
        slack: { serverName: 'slack', runtime: 'node', serverPath: 'resources/servers/slack/server.js' },
        gitlab: { serverName: 'gitlab', runtime: 'node', serverPath: 'resources/servers/gitlab/server.js' },
        bitbucket: { serverName: 'bitbucket', runtime: 'node', serverPath: 'resources/servers/bitbucket/server.js' },
        teams: { serverName: 'teams', runtime: 'node', serverPath: 'resources/servers/teams/server.js' },
        notion: { serverName: 'notion', runtime: 'node', serverPath: 'resources/servers/notion/server.js' },
        sentry: { serverName: 'sentry', runtime: 'node', serverPath: 'resources/servers/sentry/server.js' },
        stripe: { serverName: 'stripe', runtime: 'node', serverPath: 'resources/servers/stripe/server.js' },
        figma: { serverName: 'figma', runtime: 'node', serverPath: 'resources/servers/figma/server.js' },
        aws: { serverName: 'aws', runtime: 'node', serverPath: 'resources/servers/aws/server.js' }
    };
    private _view?: vscode.WebviewView;
    private _registryService = new ServerRegistryService();

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _clientManager: McpClientManager,
        private readonly _context: vscode.ExtensionContext
    ) { }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.type) {
                // --- Auth ---
                case 'login':
                    await this.handleLogin(message.email, message.password);
                    break;
                case 'register':
                    await this.handleRegister(message.email, message.password);
                    break;
                case 'loginGithub':
                    await this.handleGithubLogin();
                    break;
                case 'showDoc':
                    vscode.commands.executeCommand('flocca.showDocs', message.agentId);
                    break;
                case 'showSubscription':
                    this.showSubscriptionManager();
                    break;
                case 'logout':
                    await this.handleLogout();
                    break;

                // --- Teams ---
                case 'createTeam':
                    await this.handleCreateTeam(message.name);
                    break;
                case 'joinTeam':
                    await this.handleJoinTeam(message.code);
                    break;
                case 'inviteTeam':
                    await this.handleInviteTeam(message.teamId);
                    break;
                case 'openSeatManager':
                    await this.handleOpenSeatManager(message.teamId);
                    break;
                case 'assignSkus':
                    await this.handleAssignSkus(message.teamId, message.targetUserId, message.skus || []);
                    break;
                case 'topUpSeats':
                    await this.handleTopUpSeats(message.teamId, message.addSeats);
                    break;

                // --- Connection ---
                case 'connectCommand':
                    vscode.commands.executeCommand(message.command);
                    break;

                // --- Data ---
                case 'refreshStatus':
                    this.updateStatus();
                    break;
                case 'getCatalog':
                    const registry = this._registryService.getRegistry();
                    this._view?.webview.postMessage({
                        type: 'catalogData',
                        servers: registry
                    });
                    break;
            }
        });

        // Initial update
        setTimeout(() => this.updateStatus(), 1000);
    }

    private async handleLogin(email: string, pass: string) {
        const auth = new AuthService(this._context);
        const res = await auth.login(email, pass);
        if (res && res.user) {
            const subs = new SubscriptionService(this._context);
            await subs.setUserId(res.user.id);
            if (res.user.email) await subs.setEmail(res.user.email);
            if (res.user.entitlements) await subs.applyEntitlements(res.user.entitlements);
            vscode.window.showInformationMessage(`Welcome back, ${res.user.email}!`);
            await this.restoreConnectionsFromCloud(res.user.id);
            this.updateStatus();
        }
    }

    private async handleRegister(email: string, pass: string) {
        const auth = new AuthService(this._context);
        const subs = new SubscriptionService(this._context);
        const anonId = subs.getUserId();
        const res = await auth.register(email, pass, anonId);
        if (res && res.user) {
            await subs.setUserId(res.user.id);
            if (res.user.email) await subs.setEmail(res.user.email);
            if (res.user.entitlements) await subs.applyEntitlements(res.user.entitlements);
            vscode.window.showInformationMessage(`Account created for ${res.user.email}!`);
            await this.restoreConnectionsFromCloud(res.user.id);
            this.updateStatus();
        }
    }

    private async restoreConnectionsFromCloud(userId: string) {
        try {
            const auth = new AuthService(this._context);
            const providers = await auth.getConnectedProviders(userId);
            if (!providers.length) return;

            const restorable = providers
                .map((provider) => ({ provider, def: DashboardProvider.PROXY_RESTORE_MAP[provider] }))
                .filter((item): item is { provider: string; def: ProxyRestoreDef } => !!item.def);

            if (!restorable.length) return;

            const connected = new Set(this._clientManager.getConnectedClients());
            const configService = new McpConfigService(this._context);
            const config = await configService.loadConfig();
            if (!config) return;

            let restoredCount = 0;

            for (const { provider, def } of restorable) {
                if (connected.has(def.serverName)) continue;
                const absServerPath = this._context.asAbsolutePath(def.serverPath);
                const proxyProvider = def.proxyProvider || provider;
                const proxyEnv = {
                    FLOCCA_USER_ID: userId,
                    FLOCCA_PROXY_URL: `${CONFIG.PROXY_BASE}/${proxyProvider}`
                };

                if (!config.servers[def.serverName]) {
                    config.servers[def.serverName] = {
                        command: def.runtime,
                        args: [absServerPath],
                        env: proxyEnv
                    };
                } else {
                    config.servers[def.serverName].command = def.runtime;
                    config.servers[def.serverName].args = [absServerPath];
                    config.servers[def.serverName].env = {
                        ...(config.servers[def.serverName].env || {}),
                        ...proxyEnv
                    };
                }

                try {
                    await this._clientManager.connectLocal(def.serverName, def.runtime, [absServerPath], config.servers[def.serverName].env || proxyEnv);
                    await vscode.commands.executeCommand('setContext', `flocca.connected.${def.serverName}`, true);
                    restoredCount += 1;
                } catch (e) {
                    console.error(`Failed to auto-restore ${def.serverName}:`, e);
                }
            }

            await configService.saveConfig(config);
            if (restoredCount > 0) {
                vscode.window.showInformationMessage(`Restored ${restoredCount} cloud MCP connection(s).`);
            }
        } catch (e) {
            console.error('Cloud restore failed:', e);
        }
    }

    private async handleGithubLogin() {
        try {
            const session = await vscode.authentication.getSession('github', ['user:email', 'read:user'], { createIfNone: true });
            if (session) {
                const subs = new SubscriptionService(this._context);
                // In a real app, we'd exchange this token with our backend.
                // For now, we'll verify against backend or just assume success if VSCode confirms identity.
                // Let's call a backend endpoint if it existed, or just store the email.

                // Assuming we want to sync this with our backend via AuthService
                /* 
                const auth = new AuthService(this._context);
                const res = await auth.loginWithGithub(session.accessToken);
                */

                // For this demo/mock implementation:
                const email = session.account.label; // Often the email or username
                await subs.setEmail(email);
                // We keep the existing userId or get one from backend if we had full sync
                vscode.window.showInformationMessage(`Logged in with GitHub as ${email}`);
                this.updateStatus();
            }
        } catch (e: any) {
            vscode.window.showErrorMessage(`GitHub Login Failed: ${e.message}`);
        }
    }

    private async handleCreateTeam(name: string) {
        try {
            const teamService = new TeamService(this._context);
            await teamService.createTeam(name);
            vscode.window.showInformationMessage(`Team "${name}" created.`);
            this.updateStatus();
        } catch (e: any) {
            vscode.window.showErrorMessage(e.message);
        }
    }

    private async handleJoinTeam(code: string) {
        try {
            const teamService = new TeamService(this._context);
            await teamService.joinTeam(code);
            vscode.window.showInformationMessage(`Joined team!`);
            this.updateStatus();
        } catch (e: any) {
            vscode.window.showErrorMessage(e.message);
        }
    }

    private async handleInviteTeam(teamId: string) {
        try {
            const teamService = new TeamService(this._context);
            const res = await teamService.createInvite(teamId);
            await vscode.env.clipboard.writeText(res.code);
            vscode.window.showInformationMessage(`Invite code copied: ${res.code}`);
        } catch (e: any) {
            vscode.window.showErrorMessage(e.message);
        }
    }

    private async pushSeatManagerData(teamId: string) {
        const teamService = new TeamService(this._context);
        const [summary, assignments, skus] = await Promise.all([
            teamService.getSeatSummary(teamId),
            teamService.getSeatAssignments(teamId),
            teamService.getSkuCatalog()
        ]);

        this._view?.webview.postMessage({
            type: 'seatManagerData',
            data: { teamId, summary, assignments, skus }
        });
    }

    private async handleOpenSeatManager(teamId: string) {
        try {
            await this.pushSeatManagerData(teamId);
        } catch (e: any) {
            vscode.window.showErrorMessage(`Failed to load seat manager: ${e.message}`);
        }
    }

    private async handleAssignSkus(teamId: string, targetUserId: string, skus: string[]) {
        try {
            const teamService = new TeamService(this._context);
            await teamService.assignSkus(teamId, targetUserId, skus);
            await this.pushSeatManagerData(teamId);
            vscode.window.showInformationMessage('Seat assignment updated.');
            await this.updateStatus();
        } catch (e: any) {
            if (e?.status === 409 && e?.payload?.seats) {
                this._view?.webview.postMessage({ type: 'seatLimitExceeded', data: e.payload.seats });
            }
            vscode.window.showErrorMessage(`Failed to assign seats: ${e.message}`);
        }
    }

    private async handleTopUpSeats(teamId: string, addSeats: number) {
        try {
            const teamService = new TeamService(this._context);
            await teamService.topUpSeats(teamId, addSeats);
            await this.pushSeatManagerData(teamId);
            vscode.window.showInformationMessage('Seats added and billed immediately.');
        } catch (e: any) {
            vscode.window.showErrorMessage(`Failed to top up seats: ${e.message}`);
        }
    }

    private async handleLogout() {
        try {
            const auth = new AuthService(this._context);
            const subs = new SubscriptionService(this._context);

            const connected = this._clientManager.getConnectedClients();
            await Promise.allSettled(connected.map((name) => this._clientManager.disconnect(name)));

            await auth.clearStoredSecrets();
            await subs.clearSession();
            await vscode.commands.executeCommand('setContext', 'flocca.auth.loggedIn', false);
            await vscode.commands.executeCommand('setContext', 'flocca.auth.paid', false);

            this._view?.webview.postMessage({ type: 'loggedOut' });
            vscode.window.showInformationMessage('Logged out of Flocca. Local account and secret data cleared.');
            await this.updateStatus();
        } catch (e: any) {
            vscode.window.showErrorMessage(`Logout failed: ${e.message}`);
        }
    }

    public async updateStatus() {
        if (!this._view) return;

        const connectedServers = this._clientManager.getConnectedClients();
        const subService = new SubscriptionService(this._context);
        const isPaid = subService.isPaidUser();
        const email = subService.getEmail();
        const planTier = subService.getEntitlements()?.planTier || 'free';
        const planLabel = !email
            ? 'Not Signed In'
            : planTier === 'enterprise'
                ? 'Enterprise'
                : planTier === 'team'
                    ? 'Teams'
                    : isPaid
                        ? 'Pro'
                        : 'Free/Trial';
        await vscode.commands.executeCommand('setContext', 'flocca.auth.loggedIn', !!email);
        await vscode.commands.executeCommand('setContext', 'flocca.auth.paid', isPaid);

        // Get full registry to map IDs to Names/Descriptions for the dynamic list
        const allServers = this._registryService.getRegistry();

        let teams: any[] = [];
        if (email) {
            try {
                const teamService = new TeamService(this._context);
                teams = await teamService.getMyTeams();
            } catch (e) { console.error('Failed to fetch teams', e); }
        }

        this._view.webview.postMessage({
            type: 'updateStatus',
            status: {
                connectedServers,
                isPaid,
                email,
                userId: subService.getUserId(),
                plan: planLabel,
                teams,
                allServers // Sending registry to the frontend to help render names
            }
        });
    }

    public showLogin() {
        this._view?.webview.postMessage({ type: 'showLogin' });
    }

    public showAccountManager() {
        this._view?.webview.postMessage({ type: 'showAccount' });
    }

    public showSubscriptionManager() {
        this._view?.webview.postMessage({ type: 'showSubscription' });
    }

    public showServerCatalog() {
        this._view?.webview.postMessage({ type: 'showCatalog' });
    }

    public async restoreConnectionsForCurrentUser() {
        const subService = new SubscriptionService(this._context);
        const userId = subService.getUserId();
        if (userId && userId !== 'unknown') {
            await this.restoreConnectionsFromCloud(userId);
            await this.updateStatus();
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Flocca Dashboard</title>
             <style>
                body { font-family: var(--vscode-font-family); padding: 0; margin: 0; color: var(--vscode-foreground); display: flex; flex-direction: column; height: 100vh; }
                
                /* Main Content */
                .content { flex: 1; padding: 15px; overflow-y: auto; position: relative; }
                
                .view-section { display: none; }
                .view-section.active { display: block; }
                
                h3 { margin: 0 0 10px 0; font-size: 11px; text-transform: uppercase; color: var(--vscode-descriptionForeground); font-weight: 600; }

                /* Cards */
                .card {
                    background: var(--vscode-editor-background); /* Slightly lighter/darker than sidebar */
                    border: 1px solid var(--vscode-widget-border);
                    border-radius: 6px;
                    padding: 10px;
                    margin-bottom: 8px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                }
                .card.connected { border-left: 3px solid #4CAF50; }
                .card-title { font-size: 13px; font-weight: 600; display: flex; align-items: center; }
                .status-dot {
                    height: 6px; width: 6px; border-radius: 50%;
                    display: inline-block; margin-right: 8px;
                    background-color: var(--vscode-descriptionForeground); opacity: 0.5;
                }
                .connected .status-dot { background-color: #4CAF50; opacity: 1; }
                .desc { font-size: 11px; opacity: 0.7; margin-top: 2px; }
                
                /* Buttons */
                /* Button Color System */
                :root {
                    --btn-connect: #6c5ce7;      /* Purple */
                    --btn-connecting: #2d3436;   /* Dark */
                    --btn-connected: #00b894;    /* Teal */
                    --btn-text: #ffffff;
                }

                button {
                    background: var(--btn-connect);
                    color: var(--btn-text);
                    border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer;
                    font-weight: 500; font-size: 12px;
                    transition: opacity 0.2s;
                }
                button:hover { opacity: 0.9; }
                
                /* State Variants */
                button:disabled, button.connected {
                    background: var(--btn-connected);
                    opacity: 1; cursor: default;
                }
                
                button.connecting {
                    background: var(--btn-connecting);
                    cursor: wait;
                }

                /* Override for specific action buttons if needed, but keeping consistent base */
                .btn-block { width: 100%; margin-bottom: 8px; padding: 8px; }
                
                /* Secondary actions (like Cancel) usually plain logic, but user said "All buttons only 3 colors" 
                   This is risky for "Cancel" or "Close". I will interpret "All buttons" as main action buttons.
                   But for consistency, I will make secondary buttons "Connecting" color (Dark) if applicable
                   OR keep them subtle. 
                   Actually, let's make secondary (like Manage Teams) use the "Connecting" (Dark) color as it's neutral.
                */
                .btn-secondary { background: var(--btn-connecting); }

                .add-server-btn {
                    background: var(--btn-connect); 
                    color: white;
                    font-size: 13px; padding: 8px 16px; margin-top: 5px;
                    box-shadow: 0 2px 5px rgba(0,0,0,0.2);
                }

                .upgrade-btn {
                    background: var(--btn-connect); /* Use Connect color for upgrade too, or Teal? Let's use Connect (Purple) */
                    color: white;
                    font-weight: bold;
                    width: 100%;
                }

                /* Dropdown Menu */
                .dropdown-menu {
                    position: absolute; top: 40px; right: 10px;
                    background: var(--vscode-dropdown-background);
                    border: 1px solid var(--vscode-widget-border);
                    border-radius: 4px; box-shadow: 0 4px 10px rgba(0,0,0,0.3);
                    width: 180px; display: none; z-index: 100;
                }
                .dropdown-menu.show { display: block; }
                .dropdown-item {
                    padding: 8px 12px; cursor: pointer; font-size: 13px; display: block;
                    color: var(--vscode-dropdown-foreground); text-decoration: none;
                }
                .dropdown-item:hover { background: var(--vscode-list-hoverBackground); }
                .dropdown-divider { height: 1px; background: var(--vscode-widget-border); margin: 4px 0; }
                .dropdown-header { font-size: 10px; opacity: 0.6; padding: 4px 12px; text-transform: uppercase; margin-top: 4px;}

                /* Modals (Overlay) */
                .modal-overlay {
                    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(0,0,0,0.4); z-index: 200;
                    display: none; align-items: center; justify-content: center;
                }
                .modal-overlay.show { display: flex; }
                .modal {
                    background: var(--vscode-sideBar-background);
                    border: 1px solid var(--vscode-widget-border);
                    border-radius: 6px; padding: 20px; width: 85%; max-width: 320px;
                    box-shadow: 0 8px 24px rgba(0,0,0,0.5);
                }
                .modal h3 { margin-top: 0; font-size: 14px; color: var(--vscode-foreground); }
                input {
                    background: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    padding: 8px; width: 100%; box-sizing: border-box; margin-bottom: 12px;
                    border-radius: 2px;
                }
                .password-wrap { position: relative; margin-bottom: 12px; }
                .password-wrap input { margin-bottom: 0; padding-right: 36px; }
                .password-toggle {
                    position: absolute;
                    top: 50%;
                    right: 6px;
                    transform: translateY(-50%);
                    width: 26px;
                    height: 26px;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: 6px;
                    background: transparent;
                    color: var(--vscode-input-foreground);
                    border: 1px solid transparent;
                    cursor: pointer;
                    opacity: 0.75;
                    padding: 0;
                }
                .password-toggle:hover {
                    opacity: 1;
                    border-color: var(--vscode-widget-border);
                    background: var(--vscode-list-hoverBackground);
                }
                .close-modal { float: right; cursor: pointer; font-size: 16px; opacity: 0.7; }
                .close-modal:hover { opacity: 1; }
                .auth-error { color: var(--vscode-inputValidation-errorForeground, #f48771); font-size: 11px; margin: -8px 0 8px; min-height: 14px; }

                /* Catalog Style */
                .catalog-item {
                    border-bottom: 1px solid var(--vscode-widget-border);
                    padding: 12px 0; display: flex; justify-content: space-between; align-items: center;
                }
                .back-btn { margin-bottom: 15px; font-size: 12px; text-decoration: underline; cursor: pointer; }
                .info-icon { cursor: pointer; opacity: 0.6; font-size: 14px; }
                .info-icon:hover { opacity: 1; color: var(--btn-connect); }
            </style>
        </head>
        <body>
            <!-- Main Dashboard -->
            <div class="content">
                <div id="view-dashboard" class="view-section active">
                    <h3>Your MCP Servers</h3>
                    
                    <div id="server-list">
                        <!-- Dynamic List goes here -->
                    </div>

                    <div style="text-align: center; margin-top: 15px;">
                        <button class="add-server-btn" onclick="showCatalog()">Add New Server</button>
                    </div>

                    <div id="upgrade-section" style="margin-top: 25px; border-top: 1px solid var(--vscode-widget-border); padding-top: 15px;">
                         <!-- Upgrade button injected here if free -->
                    </div>
                </div>

                <!-- Catalog View -->
                <div id="view-catalog" class="view-section">
                    <div class="back-btn" onclick="showDashboard()">← Back to Dashboard</div>
                    <h3>Server Catalog</h3>
                    <input type="text" id="search" placeholder="Search servers..." onkeyup="filterCatalog()" />
                    <div id="catalog-list"></div>
                </div>
            </div>

            <!-- Modals -->
            <div id="modal-login" class="modal-overlay">
                <div class="modal">
                    <span class="close-modal" onclick="closeModals()">✕</span>
                    <h3>Sign In</h3>
                    <div style="font-size: 11px; text-align: center; margin-bottom: 8px; opacity: 0.85;">
                        Recommended: GitHub is the fastest way to sign in.
                    </div>
                    <button class="btn-block" onclick="doGithubLogin()" style="background:#24292e; color:white; margin-bottom: 10px;">Continue with GitHub</button>
                    <div style="font-size: 11px; text-align: center; opacity: 0.65; margin-bottom: 8px;">
                        or sign in with email
                    </div>
                    <input type="email" id="login-email" placeholder="Email" />
                    <div class="password-wrap">
                        <input type="password" id="login-pass" placeholder="Password" />
                        <button type="button" class="password-toggle" onclick="togglePassword('login-pass', this)" aria-label="Show password">👁</button>
                    </div>
                    <button id="login-btn" class="btn-block" onclick="doLogin()" disabled>Login</button>
                    <div style="font-size: 11px; text-align: center; opacity: 0.7;">
                        No account? <a href="#" onclick="switchModal('modal-register')">Register</a>
                    </div>
                </div>
            </div>

            <div id="modal-register" class="modal-overlay">
                <div class="modal">
                    <span class="close-modal" onclick="closeModals()">✕</span>
                    <h3>Register</h3>
                    <div style="font-size: 11px; text-align: center; margin-bottom: 8px; opacity: 0.85;">
                        Recommended: Start with GitHub for the easiest setup.
                    </div>
                    <button class="btn-block" onclick="doGithubLogin()" style="background:#24292e; color:white; margin-bottom: 10px;">Continue with GitHub</button>
                    <div style="font-size: 11px; text-align: center; opacity: 0.65; margin-bottom: 8px;">
                        or register with email
                    </div>
                    <input type="email" id="reg-email" placeholder="Email" />
                    <div class="password-wrap">
                        <input type="password" id="reg-pass" placeholder="Password" />
                        <button type="button" class="password-toggle" onclick="togglePassword('reg-pass', this)" aria-label="Show password">👁</button>
                    </div>
                    <div class="password-wrap">
                        <input type="password" id="reg-confirm-pass" placeholder="Confirm Password" />
                        <button type="button" class="password-toggle" onclick="togglePassword('reg-confirm-pass', this)" aria-label="Show password">👁</button>
                    </div>
                    <div id="register-error" class="auth-error"></div>
                    <button id="register-btn" class="btn-block" onclick="doRegister()" disabled>Create Account</button>
                    <div style="font-size: 11px; text-align: center; opacity: 0.7;">
                        Has an account? <a href="#" onclick="switchModal('modal-login')">Sign In</a>
                    </div>
                </div>
            </div>

            <div id="modal-teams" class="modal-overlay">
                <div class="modal">
                    <span class="close-modal" onclick="closeModals()">✕</span>
                    <h3>Manage Teams</h3>
                    <div id="my-teams-list" style="max-height: 100px; overflow-y: auto; margin-bottom: 10px; border-bottom: 1px solid var(--vscode-widget-border); padding-bottom: 5px;"></div>
                    
                    <input type="text" id="new-team-name" placeholder="New Team Name" />
                    <button class="btn-block btn-secondary" onclick="createTeam()">Create Team</button>
                    
                    <div style="height: 10px;"></div>
                    <input type="text" id="join-code" placeholder="Invite Code" />
                    <button class="btn-block btn-secondary" onclick="joinTeam()">Join Team</button>
                </div>
            </div>

            <div id="modal-seats" class="modal-overlay">
                <div class="modal" style="max-width: 560px; width: 92%;">
                    <span class="close-modal" onclick="closeModals()">✕</span>
                    <h3>Seat Management</h3>
                    <div id="seat-summary" style="font-size:12px; margin-bottom:10px;"></div>
                    <div id="seat-limit-banner" style="display:none; margin-bottom:10px; padding:8px; border:1px solid var(--vscode-inputValidation-warningBorder);"></div>
                    <div id="seat-assignments" style="max-height: 240px; overflow-y: auto; border-top: 1px solid var(--vscode-widget-border); padding-top: 8px;"></div>
                    <div id="seat-topup" style="margin-top:10px; border-top: 1px solid var(--vscode-widget-border); padding-top:10px; display:none;">
                        <input type="number" id="topup-count" placeholder="Seats to add" />
                        <button class="btn-block" onclick="topUpSeats()">Add Seats (Billed Now)</button>
                    </div>
                </div>
            </div>

            <div id="modal-account" class="modal-overlay">
                <div class="modal">
                    <span class="close-modal" onclick="closeModals()">✕</span>
                    <h3>Manage Account</h3>
                    <div style="font-size:12px; line-height:1.6; margin-bottom:10px;">
                        <div><b>Email:</b> <span id="acct-email">Not Signed In</span></div>
                        <div><b>User ID:</b> <span id="acct-userid">-</span></div>
                        <div><b>Plan:</b> <span id="acct-plan">-</span></div>
                    </div>
                    <button id="acct-manage-sub-btn" class="btn-block" onclick="openSubscriptionModal()" style="display:none;">Manage Subscription</button>
                    <button id="acct-upgrade-btn" class="btn-block" onclick="post('connectCommand', 'flocca.upgrade')" style="display:none;">Upgrade to Pro</button>
                    <button class="btn-block btn-secondary" onclick="doLogout()">Logout</button>
                </div>
            </div>

            <div id="modal-subscription" class="modal-overlay">
                <div class="modal">
                    <span class="close-modal" onclick="closeModals()">✕</span>
                    <h3>Manage Subscription</h3>
                    <div style="font-size:12px; line-height:1.6; margin-bottom:10px;">
                        <div><b>Current Plan:</b> <span id="sub-plan">-</span></div>
                        <div style="opacity:.75;">Upgrade seats and plans instantly, or cancel from billing management.</div>
                    </div>
                    <button class="btn-block" onclick="post('connectCommand', 'flocca.upgradeTeams')">Upgrade to Teams</button>
                    <button class="btn-block" onclick="post('connectCommand', 'flocca.upgradeEnterprise')">Upgrade to Enterprise</button>
                    <button class="btn-block btn-secondary" onclick="post('connectCommand', 'flocca.openBillingManagement')">Open Billing Management</button>
                    <button class="btn-block btn-secondary" onclick="post('connectCommand', 'flocca.cancelSubscription')">Cancel Subscription</button>
                </div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                let catalogData = [];
                let connectedList = [];
                let currentEmail = null;
                let myTeams = [];
                let seatManager = { teamId: null, summary: null, assignments: [], skus: [] };

                function post(type, data) {
                    if (typeof data === 'string') { vscode.postMessage({ type, command: data }); }
                    else { vscode.postMessage({ type, ...data }); }
                }

                // Default Servers to always show
                const defaultServers = [
                    { id: 'github', name: 'GitHub', desc: 'Local Server', command: 'flocca.connectGitHub' },
                    { id: 'jira', name: 'Jira', desc: 'Atlassian Cloud', command: 'flocca.connectJira' },
                    { id: 'confluence', name: 'Confluence', desc: 'Atlassian Cloud', command: 'flocca.connectConfluence' }
                ];

                function normalizeServerId(id) {
                    return String(id || '').trim().toLowerCase().replace(/_/g, '-');
                }

                function renderServerList(allServersRegistry) {
                    const listDiv = document.getElementById('server-list');
                    listDiv.innerHTML = '';

                    const registryById = new Map();
                    (allServersRegistry || []).forEach((r) => {
                        registryById.set(normalizeServerId(r.id), r);
                    });

                    const normalizedConnected = (connectedList || []).map(normalizeServerId);

                    // 1. Build connected list (always visible)
                    let connectedDisplay = [];
                    const seen = new Set();
                    normalizedConnected.forEach((connId) => {
                        if (seen.has(connId)) return;
                        seen.add(connId);
                        const info = registryById.get(connId);
                        if (info) {
                            connectedDisplay.push({
                                id: normalizeServerId(info.id),
                                name: info.name,
                                desc: info.description,
                                command: info.connectCommand || ''
                            });
                        } else {
                            connectedDisplay.push({
                                id: connId,
                                name: connId,
                                desc: 'Connected',
                                command: ''
                            });
                        }
                    });

                    // 2. Build available quick-connect list (non-connected defaults)
                    let availableDisplay = [];
                    defaultServers.forEach((srv) => {
                        const id = normalizeServerId(srv.id);
                        if (!seen.has(id)) {
                            availableDisplay.push({
                                id,
                                name: srv.name,
                                desc: srv.desc,
                                command: srv.command
                            });
                        }
                    });

                    const connectedHeader = document.createElement('h3');
                    connectedHeader.textContent = \`Connected (\${connectedDisplay.length})\`;
                    listDiv.appendChild(connectedHeader);

                    if (connectedDisplay.length === 0) {
                        const empty = document.createElement('div');
                        empty.className = 'desc';
                        empty.style.marginBottom = '10px';
                        empty.textContent = 'No MCP servers connected yet.';
                        listDiv.appendChild(empty);
                    }

                    const renderCards = (servers) => {
                        servers.forEach(srv => {
                            const isConnected = normalizedConnected.includes(normalizeServerId(srv.id));
                            const card = document.createElement('div');
                            card.className = 'card' + (isConnected ? ' connected' : '');

                            let btnText = isConnected ? '✓ Connected' : 'Connect';
                            let btnClass = isConnected ? 'connected' : '';
                            let btnHtml = \`<button class="\${btnClass}" \${isConnected ? 'disabled' : ''} onclick="post('connectCommand', '\${srv.command}')">\${btnText}</button>\`;

                            card.innerHTML = \`
                                <div>
                                    <div class="card-title"><span class="status-dot"></span> \${srv.name}</div>
                                    <div class="desc">\${srv.desc || ''}</div>
                                </div>
                                \${btnHtml}
                            \`;
                            listDiv.appendChild(card);
                        });
                    };

                    renderCards(connectedDisplay);

                    const availableHeader = document.createElement('h3');
                    availableHeader.style.marginTop = '14px';
                    availableHeader.textContent = \`Available to Connect (\${availableDisplay.length})\`;
                    listDiv.appendChild(availableHeader);
                    renderCards(availableDisplay);
                }

                // Modals
                function openModal(id) {
                    document.querySelectorAll('.modal-overlay').forEach(e => e.classList.remove('show'));
                    document.getElementById(id).classList.add('show');
                    if(id==='modal-teams') renderTeamsList();
                }
                function closeModals() {
                    document.querySelectorAll('.modal-overlay').forEach(e => e.classList.remove('show'));
                }
                function switchModal(id) { closeModals(); openModal(id); }
                function openAccountModal() {
                    const email = (window.__floccaStatus && window.__floccaStatus.email) || 'Not Signed In';
                    const userId = (window.__floccaStatus && window.__floccaStatus.userId) || '-';
                    const plan = (window.__floccaStatus && window.__floccaStatus.plan) || '-';
                    const isPaid = !!(window.__floccaStatus && window.__floccaStatus.isPaid);
                    document.getElementById('acct-email').textContent = email;
                    document.getElementById('acct-userid').textContent = userId;
                    document.getElementById('acct-plan').textContent = plan;
                    document.getElementById('acct-manage-sub-btn').style.display = isPaid ? 'block' : 'none';
                    document.getElementById('acct-upgrade-btn').style.display = !isPaid ? 'block' : 'none';
                    openModal('modal-account');
                }
                function openSubscriptionModal() {
                    const plan = (window.__floccaStatus && window.__floccaStatus.plan) || '-';
                    document.getElementById('sub-plan').textContent = plan;
                    openModal('modal-subscription');
                }
                function togglePassword(inputId, btn) {
                    const input = document.getElementById(inputId);
                    if (!input) return;
                    const show = input.type === 'password';
                    input.type = show ? 'text' : 'password';
                    btn.textContent = show ? '🙈' : '👁';
                    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
                }
                function updateAuthButtons() {
                    const loginEmail = document.getElementById('login-email');
                    const loginPass = document.getElementById('login-pass');
                    const loginBtn = document.getElementById('login-btn');
                    const regEmail = document.getElementById('reg-email');
                    const regPass = document.getElementById('reg-pass');
                    const regConfirm = document.getElementById('reg-confirm-pass');
                    const regBtn = document.getElementById('register-btn');
                    const regErr = document.getElementById('register-error');

                    if (loginEmail && loginPass && loginBtn) {
                        const canLogin = loginEmail.value.trim().length > 0 && loginPass.value.trim().length > 0;
                        loginBtn.disabled = !canLogin;
                    }

                    if (regEmail && regPass && regConfirm && regBtn && regErr) {
                        const hasAll = regEmail.value.trim().length > 0 && regPass.value.length > 0 && regConfirm.value.length > 0;
                        const matches = regPass.value === regConfirm.value;
                        regBtn.disabled = !(hasAll && matches);
                        if (hasAll && !matches) {
                            regErr.textContent = 'Passwords do not match.';
                        } else {
                            regErr.textContent = '';
                        }
                    }
                }

                function renderTeamsList() {
                    const list = document.getElementById('my-teams-list');
                    if(myTeams.length===0) { list.innerHTML='<div style="font-size:11px; padding:5px;">No teams.</div>'; return; }
                    let h = '';
                    myTeams.forEach(t => {
                        const canManage = t.role === 'OWNER' || t.role === 'ADMIN';
                        h += \`<div style="display:flex; justify-content:space-between; margin-bottom:5px; font-size:12px;">
                                <span>\${t.name} <span style="opacity:.6">(\${t.role})</span></span>
                                <span>
                                    <a href="#" onclick="post('inviteTeam', {teamId:'\${t.id}'})">Add User</a>
                                    \${canManage ? \` | <a href="#" onclick="openSeatManager('\${t.id}')">Seats</a>\` : ''}
                                </span>
                              </div>\`;
                    });
                    list.innerHTML=h;
                }

                function openSeatManager(teamId) {
                    post('openSeatManager', { teamId });
                    openModal('modal-seats');
                }

                function renderSeatManager() {
                    const s = seatManager.summary || {};
                    const plan = s.plan || 'free';
                    const topUpMinimum = s.topUpMinimum || (plan === 'enterprise' ? 10 : 3);

                    document.getElementById('seat-summary').innerHTML =
                        \`Plan: <b>\${plan}</b> | Purchased: <b>\${s.seatsPurchased || 0}</b> | Used: <b>\${s.seatsUsed || 0}</b> | Available: <b>\${s.seatsAvailable || 0}</b>\`;

                    const assignmentDiv = document.getElementById('seat-assignments');
                    assignmentDiv.innerHTML = '';

                    (seatManager.assignments || []).forEach(a => {
                        const row = document.createElement('div');
                        row.style.borderBottom = '1px solid var(--vscode-widget-border)';
                        row.style.padding = '8px 0';

                        const skuOptions = (seatManager.skus || []).map(sku => {
                            const checked = (a.skus || []).includes(sku.id) ? 'checked' : '';
                            return \`<label style="display:inline-block; margin-right:8px; font-size:11px;">
                                <input type="checkbox" data-user="\${a.userId}" data-sku="\${sku.id}" \${checked}/> \${sku.name}
                            </label>\`;
                        }).join('');

                        row.innerHTML = \`
                            <div style="font-size:12px; margin-bottom:6px;">
                                <b>\${a.email || a.userId}</b> <span style="opacity:.65">(\${a.role})</span>
                            </div>
                            <div>\${skuOptions}</div>
                            <button style="margin-top:6px;" onclick="saveSeatAssignment('\${a.userId}')">Save</button>
                        \`;
                        assignmentDiv.appendChild(row);
                    });

                    const topupDiv = document.getElementById('seat-topup');
                    const needTopup = (s.seatsAvailable || 0) <= 0 && (plan === 'teams' || plan === 'enterprise');
                    topupDiv.style.display = needTopup ? 'block' : 'none';
                    document.getElementById('topup-count').value = String(topUpMinimum);
                    document.getElementById('topup-count').min = String(topUpMinimum);

                    const banner = document.getElementById('seat-limit-banner');
                    banner.style.display = needTopup ? 'block' : 'none';
                    if (needTopup) {
                        banner.innerHTML = \`Seat limit reached. Add at least <b>\${topUpMinimum}</b> seats to continue assigning.\`;
                    }
                }

                function saveSeatAssignment(userId) {
                    const boxes = Array.from(document.querySelectorAll(\`input[type=\"checkbox\"][data-user=\"\${userId}\"]\`));
                    const skus = boxes.filter(b => b.checked).map(b => b.getAttribute('data-sku'));
                    post('assignSkus', { teamId: seatManager.teamId, targetUserId: userId, skus });
                }

                function topUpSeats() {
                    const addSeats = parseInt(document.getElementById('topup-count').value || '0', 10);
                    if (!addSeats || addSeats <= 0) return;
                    post('topUpSeats', { teamId: seatManager.teamId, addSeats });
                }

                // Auth Actions
                function doLogin() {
                    const email = document.getElementById('login-email').value;
                    const pass = document.getElementById('login-pass').value;
                    if (!email || !pass) return;
                    post('login', {email, password: pass});
                    closeModals();
                }
                function doGithubLogin() {
                    post('loginGithub', {});
                    closeModals();
                }
                function doRegister() {
                    const email = document.getElementById('reg-email').value;
                    const pass = document.getElementById('reg-pass').value;
                    const confirm = document.getElementById('reg-confirm-pass').value;
                    const err = document.getElementById('register-error');
                    if (!email || !pass || !confirm) return;
                    if (pass !== confirm) {
                        if (err) err.textContent = 'Passwords do not match.';
                        return;
                    }
                    if (err) err.textContent = '';
                    post('register', {email, password: pass});
                    closeModals();
                }
                function doLogout() {
                    post('logout', {});
                }
                function createTeam() {
                    const name = document.getElementById('new-team-name').value;
                    if(name) { post('createTeam', {name}); closeModals(); }
                }
                function joinTeam() {
                    const code = document.getElementById('join-code').value;
                    if(code) { post('joinTeam', {code}); closeModals(); }
                }

                // View Switching
                function showCatalog() {
                    document.getElementById('view-dashboard').classList.remove('active');
                    document.getElementById('view-catalog').classList.add('active');
                    if(catalogData.length===0) post('getCatalog',{});
                }
                function showDashboard() {
                    document.getElementById('view-catalog').classList.remove('active');
                    document.getElementById('view-dashboard').classList.add('active');
                }

                window.addEventListener('message', event => {
                    const msg = event.data;
                    if (msg.type === 'updateStatus') {
                        window.__floccaStatus = msg.status || {};
                        const { email, teams, connectedServers, isPaid, allServers } = msg.status;
                        currentEmail = email;
                        myTeams = teams || [];
                        connectedList = connectedServers || [];
                        
                        // Render Main List
                        // If allServers is undefined (first load?), allow fallback or wait for catalog
                        renderServerList(allServers || []);

                        // Upgrade Button
                        const upgDiv = document.getElementById('upgrade-section');
                        if (isPaid) {
                            upgDiv.innerHTML = '<div style="color:#4CAF50; font-weight:bold; font-size:12px; text-align:center;">⚡ Flocca Pro Active</div>';
                        } else {
                            upgDiv.innerHTML = '<button class="upgrade-btn" onclick="post(\\'connectCommand\\', \\'flocca.upgrade\\')">Upgrade to Pro ⚡</button>';
                        }

                    } else if (msg.type === 'catalogData') {
                        catalogData = msg.servers;
                        renderCatalog(catalogData);
                    } else if (msg.type === 'showLogin') {
                        openModal('modal-login');
                    } else if (msg.type === 'showAccount') {
                        openAccountModal();
                    } else if (msg.type === 'showSubscription') {
                        openSubscriptionModal();
                    } else if (msg.type === 'showCatalog') {
                        showCatalog();
                    } else if (msg.type === 'loggedOut') {
                        closeModals();
                        openModal('modal-login');
                    } else if (msg.type === 'seatManagerData') {
                        seatManager = msg.data || { teamId: null, summary: null, assignments: [], skus: [] };
                        renderSeatManager();
                    } else if (msg.type === 'seatLimitExceeded') {
                        const b = document.getElementById('seat-limit-banner');
                        b.style.display = 'block';
                        b.innerHTML = \`Seat limit exceeded. Required additional seats: <b>\${msg.data.requiredAdditional}</b>. Recommended top-up: <b>\${msg.data.recommendedTopUp}</b>.\`;
                    }
                });

                function renderCatalog(items) {
                    const c = document.getElementById('catalog-list');
                    c.innerHTML = '';
                    items.forEach(s => {
                        const el = document.createElement('div');
                        el.className = 'catalog-item';
                        const isConn = connectedList.includes(s.id);
                        const btn = isConn ? '<button class="connected" disabled>✓ Connected</button>' : \`<button onclick="post('connectCommand', '\${s.connectCommand}')">Connect</button>\`;
                        
                        // Info Icon
                        const infoBtn = \`<span class="info-icon" onclick="post('showDoc', {agentId: '\${s.id}'})" title="Read Documentation">ⓘ</span>\`;

                        el.innerHTML = \`<div style="display:flex; align-items:center; gap:8px;">\${infoBtn} <div><div style="font-weight:600;">\${s.name}</div><div class="desc">\${s.description}</div></div></div>\${btn}\`;
                        c.appendChild(el);
                    });
                }
                function filterCatalog() {
                    const v = document.getElementById('search').value.toLowerCase();
                    renderCatalog(catalogData.filter(s => s.name.toLowerCase().includes(v) || s.description.toLowerCase().includes(v)));
                }

                ['login-email','login-pass','reg-email','reg-pass','reg-confirm-pass'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.addEventListener('input', updateAuthButtons);
                });
                updateAuthButtons();

                post('refreshStatus', {});
            </script>
        </body>
        </html>`;
    }
}
