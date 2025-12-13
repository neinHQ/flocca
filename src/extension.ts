import * as vscode from 'vscode';
import { McpConfigService } from './services/mcpConfigService';
import { McpClientManager } from './services/mcpClientService';
import { AuthService } from './services/authService';
import { DashboardProvider } from './ui/chatProvider';
import { setupTestController } from './ui/testController';
import { WorkflowService } from './services/workflowService';
import { WorkflowProvider } from './ui/workflowProvider';
import { DocProvider } from './ui/docProvider';
import { SubscriptionService } from './services/subscriptionService';

import { TelemetryService } from './services/telemetryService';

export async function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "flocca" is now active!');

    const configService = new McpConfigService(context);
    let config = await configService.loadConfig();

    const telemetryService = new TelemetryService(context);
    const subsService = new SubscriptionService(context);
    const clientManager = new McpClientManager(context, subsService, telemetryService);

    // Register Dashboard - Initialize it early so we can update status
    const dashboardProvider = new DashboardProvider(context.extensionUri, clientManager, context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(DashboardProvider.viewType, dashboardProvider)
    );

    // Initialize Clients in Background
    if (config) {
        console.log('Loaded MCP Config:', JSON.stringify(config, null, 2));
        vscode.window.showInformationMessage(`Flocca loaded ${Object.keys(config.mcpServers).length} MCP servers.`);
        const authService = new AuthService(context);

        // Async Background Connection - Do NOT await here to block startup
        (async () => {
            const promises = Object.entries(config.mcpServers).map(async ([name, server]) => {
                try {
                    if (server.url) {
                        let token: string | undefined;

                        if (name === 'github') {
                            token = await authService.getGitHubToken(false); // Silent check
                        } else if (name === 'jira' || name === 'confluence') {
                            token = await authService.getAtlassianToken();
                        }

                        if (token) {
                            const url = server.url;
                            const authHeader = server.env && server.env['Authorization'];
                            const headers: Record<string, string> = {};
                            if (authHeader) headers['Authorization'] = authHeader;
                            if (name === 'github') headers['Authorization'] = `Bearer ${token}`;
                            if (name === 'jira' || name === 'confluence') headers['Authorization'] = `Bearer ${token}`;

                            await clientManager.connectRemote(name, url, headers);
                        } else {
                            console.log(`Skipping ${name}: No credentials found.`);
                        }

                    } else if (server.command) {
                        let env = server.env || {};

                        if (name === 'slack') {
                            const slackToken = await authService.getSlackToken();
                            if (!slackToken) {
                                console.log('Slack token not found. Skipping auto-connect.');
                                return;
                            }
                            env = { ...env, SLACK_BOT_TOKEN: slackToken };
                        }

                        await clientManager.connectLocal(name, server.command, server.args || [], env);
                    }
                } catch (err: any) {
                    console.error(`Failed to connect to MCP server ${name}:`, err);
                    if (name === 'github') vscode.commands.executeCommand('setContext', 'flocca.connected.github', false);
                    if (name === 'jira') vscode.commands.executeCommand('setContext', 'flocca.connected.jira', false);
                    if (name === 'confluence') vscode.commands.executeCommand('setContext', 'flocca.connected.confluence', false);
                }
            });

            await Promise.allSettled(promises);
            // Update dashboard only after all initial attempts finished
            dashboardProvider.updateStatus();
        })();
    }

    // Helper to sync config to disk if Paid user AND update Dashboard
    const syncAndNotify = async (connectedService?: string) => {
        // 1. Sync Logic
        const configService = new McpConfigService(context);

        if (subsService.isPaidUser()) {
            const config = await configService.loadConfig();
            if (config) {
                const auth = new AuthService(context);
                const ghToken = await auth.getGitHubToken(false);
                if (ghToken && config.mcpServers['github']?.command) {
                    config.mcpServers['github'].env = {
                        ...(config.mcpServers['github'].env || {}),
                        'GITHUB_PERSONAL_ACCESS_TOKEN': ghToken
                    };
                }
                const slackToken = await auth.getSlackToken();
                if (slackToken && config.mcpServers['slack']) {
                    config.mcpServers['slack'].env = {
                        ...(config.mcpServers['slack'].env || {}),
                        'SLACK_BOT_TOKEN': slackToken
                    };
                }

                await configService.saveConfig(config);
            }
        } else {
            await configService.deleteConfig();
        }

        // 2. Dashboard Update
        // We can call dashboardProvider.updateStatus() directly
        dashboardProvider.updateStatus();
    };

    // Run Sync on Startup
    await syncAndNotify();

    // Setup Test Controller
    setupTestController(context, clientManager);

    // Workflow Service & Provider
    const workflowService = new WorkflowService(context, clientManager, telemetryService);
    const workflowProvider = new WorkflowProvider(context.extensionUri, workflowService, clientManager);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(WorkflowProvider.viewType, workflowProvider)
    );

    // Doc Provider
    const docProvider = new DocProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(DocProvider.viewType, docProvider)
    );
    context.subscriptions.push(vscode.commands.registerCommand('flocca.showDocs', (agentId: string) => {
        docProvider.showDoc(agentId);
        // Focus view
        vscode.commands.executeCommand('flocca-docs.focus');
    }));



    context.subscriptions.push(vscode.commands.registerCommand('flocca.debug.setPro', async () => {
        await subsService.upgradeToPro();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('flocca.debug.expireTrial', async () => {
        await subsService.expireTrial();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('flocca.debug.resetTrial', async () => {
        await subsService.resetTrial();
    }));

    let disposable = vscode.commands.registerCommand('flocca.helloWorld', () => {
        vscode.window.showInformationMessage('Hello World from flocca!');
    });

    context.subscriptions.push(disposable);



    // Initial Connection Loop
    // ... (Startup loop logic remains, we just need to ensure it triggers updateState at end)

    const updateState = async () => {
        console.log('Running updateState...');
        // 1. Sync Config (Pro)
        const subs = new SubscriptionService(context);
        const configService = new McpConfigService(context);


        const config = await configService.loadConfig();
        if (config) {
            const auth = new AuthService(context);

            // 1. GitHub
            console.log('Checking GitHub Token...');
            const ghToken = await auth.getGitHubToken(false);
            console.log('GitHub Token found:', !!ghToken);

            if (ghToken) {
                if (!config.mcpServers['github']) {
                    console.log('Auto-creating GitHub config');
                    config.mcpServers['github'] = {
                        command: 'node',
                        args: [context.asAbsolutePath('resources/servers/github/server.js')],
                        env: {}
                    };
                }

                if (config.mcpServers['github'].command) {
                    config.mcpServers['github'].env = {
                        ...(config.mcpServers['github'].env || {}),
                        'GITHUB_PERSONAL_ACCESS_TOKEN': ghToken
                    };

                    // Critical: Connect immediately since we might have missed the initial startup loop
                    try {
                        await clientManager.connectLocal(
                            'github',
                            config.mcpServers['github'].command,
                            config.mcpServers['github'].args || [],
                            config.mcpServers['github'].env
                        );
                        vscode.commands.executeCommand('setContext', 'flocca.connected.github', true);
                    } catch (e) { console.error('Auto-connect GitHub failed:', e); }
                }
            }

            // 2. Playwright (Auto-Connect unless disconnected)
            if (!context.globalState.get('flocca.disconnected.playwright')) {
                if (!config.mcpServers['playwright']) {
                    console.log('Auto-creating Playwright config');
                    config.mcpServers['playwright'] = {
                        command: 'node',
                        args: [context.asAbsolutePath('resources/servers/playwright/server.js')],
                        env: {
                            FLOCCA_USER_ID: subs.getUserId(),
                            FLOCCA_PROXY_URL: `http://localhost:3000/proxy/playwright`
                        }
                    };
                }
                // Connect
                try {
                    // Only connect if not already connected
                    if (!clientManager.getClient('playwright')) {
                        await clientManager.connectLocal(
                            'playwright',
                            config.mcpServers['playwright'].command || 'node',
                            config.mcpServers['playwright'].args || [],
                            config.mcpServers['playwright'].env
                        );
                        vscode.commands.executeCommand('setContext', 'flocca.connected.playwright', true);
                    }
                } catch (e) { console.error('Auto-connect Playwright failed', e); }
            }

            // 3. Pytest (Auto-Connect unless disconnected)
            if (!context.globalState.get('flocca.disconnected.pytest')) {
                if (!config.mcpServers['pytest']) {
                    console.log('Auto-creating Pytest config');
                    config.mcpServers['pytest'] = {
                        command: 'python3',
                        args: [context.asAbsolutePath('resources/servers/pytest/server.py')],
                        env: {
                            FLOCCA_USER_ID: subs.getUserId(),
                            FLOCCA_PROXY_URL: `http://localhost:3000/proxy/pytest`
                        }
                    };
                }
                try {
                    if (!clientManager.getClient('pytest')) {
                        await clientManager.connectLocal(
                            'pytest',
                            config.mcpServers['pytest'].command || 'python3',
                            config.mcpServers['pytest'].args || [],
                            config.mcpServers['pytest'].env
                        );
                        vscode.commands.executeCommand('setContext', 'flocca.connected.pytest', true);
                    }
                } catch (e) { console.error('Auto-connect Pytest failed', e); }
            }

            // 4. Slack
            const slackToken = await auth.getSlackToken();
            if (slackToken && config.mcpServers['slack']) {
                config.mcpServers['slack'].env = {
                    ...(config.mcpServers['slack'].env || {}),
                    'SLACK_BOT_TOKEN': slackToken
                };
            }

            console.log('Saving config...');
            await configService.saveConfig(config);
        }


        // 2. Update UI
        dashboardProvider.updateStatus();
    };

    // --- Disconnect Command ---
    context.subscriptions.push(vscode.commands.registerCommand('flocca.disconnect', async () => {
        const connected = clientManager.getConnectedClients();
        if (connected.length === 0) {
            vscode.window.showInformationMessage('No active connections to disconnect.');
            return;
        }

        const selected = await vscode.window.showQuickPick(connected, { placeHolder: 'Select server to disconnect' });
        if (selected) {
            await clientManager.disconnect(selected);
            // Mark as disconnected preference
            await context.globalState.update(`flocca.disconnected.${selected}`, true);

            // Remove from config (Optional: keeps config clean, prevents auto-reconnect if logic changes)
            const configService = new McpConfigService(context);
            const config = await configService.loadConfig();
            if (config && config.mcpServers[selected]) {
                delete config.mcpServers[selected];
                await configService.saveConfig(config);
            }

            vscode.commands.executeCommand('setContext', `flocca.connected.${selected}`, false);
            dashboardProvider.updateStatus();
            vscode.window.showInformationMessage(`Disconnected from ${selected}.`);
        }
    }));

    // Run Sync Check on Startup
    await updateState();

    context.subscriptions.push(vscode.commands.registerCommand('flocca.connectGitHub', async () => {
        try {
            const auth = new AuthService(context);
            const token = await auth.getGitHubToken(true, true); // Create if none, force new session if needed

            if (token) {
                // Manually trigger the config update logic for GitHub
                const configService = new McpConfigService(context);
                const config = await configService.loadConfig();

                if (config) {
                    if (!config.mcpServers['github']) {
                        // Auto-configure if missing
                        config.mcpServers['github'] = {
                            command: 'node',
                            args: [context.asAbsolutePath('resources/servers/github/server.js')],
                            env: {}
                        };
                    }

                    config.mcpServers['github'].env = {
                        ...(config.mcpServers['github'].env || {}),
                        'GITHUB_PERSONAL_ACCESS_TOKEN': token
                    };
                    await configService.saveConfig(config);

                    // Explicitly connect immediately so UI updates
                    await clientManager.connectLocal(
                        'github',
                        'node',
                        [context.asAbsolutePath('resources/servers/github/server.js')],
                        config.mcpServers['github'].env
                    );

                    await updateState(); // Refresh UI
                    vscode.window.showInformationMessage('Successfully connected to GitHub!');
                } else {
                    vscode.window.showErrorMessage('Failed to load MCP config.');
                }
            }
        } catch (e: any) {
            vscode.window.showErrorMessage(`Failed to connect GitHub: ${e.message}`);
        }
    }));

    // Tool Command
    context.subscriptions.push(vscode.commands.registerCommand('flocca.searchRepos', async () => {
        const query = await vscode.window.showInputBox({ prompt: "Enter search query for GitHub repositories" });
        if (query) {
            try {
                // Assuming 'github' is the server name from default config
                const result = await clientManager.callTool('github', 'search_repositories', { query: query });

                // Show result in a new document or output channel
                const doc = await vscode.workspace.openTextDocument({ content: JSON.stringify(result, null, 2), language: 'json' });
                await vscode.window.showTextDocument(doc);
            } catch (e) {
                vscode.window.showErrorMessage(`Failed to search repos: ${e}`);
            }
        }
    }));




    context.subscriptions.push(vscode.commands.registerCommand('flocca.jiraShell', async () => {
        // Similar to searchRepos but for Jira
        const query = await vscode.window.showInputBox({ prompt: "Jira Issue JQL or ID" });
        if (query) {
            try {
                // Inject token into env if not already there, OR relay it via headers during connection
                // Ideally connection is long-lived. 
                // If we rely on mcp.json, the user might need to put the token in mcp.json "env"
                // BUT we are storing it in Keychain. 
                // We need to fetch it and pass it.
                // The connection happens on startup. This suggests we should load secrets on startup 
                // and merge them into the config's env/headers.

                const result = await clientManager.callTool('jira', 'jira.search', { jql: query });
                const doc = await vscode.workspace.openTextDocument({ content: JSON.stringify(result, null, 2), language: 'json' });
                await vscode.window.showTextDocument(doc);
            } catch (e) {
                vscode.window.showErrorMessage(`Jira tool execution failed: ${e}`);
            }
        }
    }));



    // Upgrade Command
    context.subscriptions.push(vscode.commands.registerCommand('flocca.upgrade', async () => {
        await subsService.upgradeToPro();
    }));

    // Poll status on startup
    subsService.pollSubscriptionStatus();

    // Poll status on startup
    subsService.pollSubscriptionStatus();

    context.subscriptions.push(vscode.commands.registerCommand('flocca.manageAccounts', async () => {
        const userId = subsService.getUserId();
        const email = subsService.getEmail() || 'Not Signed In';
        const plan = subsService.getStatus() === 'active' ? (subsService.isPaidUser() ? 'Pro' : 'Trial') : 'Expired';

        vscode.window.showInformationMessage(`Flocca Account: ${email}\nUser ID: ${userId}\nPlan: ${plan}`, "Copy ID", "Upgrade").then(selection => {
            if (selection === "Upgrade") subsService.upgradeToPro();
            if (selection === "Copy ID") vscode.env.clipboard.writeText(userId);
        });
    }));

    // Trigger Login Modal via Sign In Icon
    context.subscriptions.push(vscode.commands.registerCommand('flocca.signin', () => {
        dashboardProvider.showLogin();
    }));

    // --- Connect Commands ---

    context.subscriptions.push(vscode.commands.registerCommand('flocca.connectZephyr', () =>
        connectWithWebview('zephyr', 'zephyr', 'resources/servers/zephyr/server.js', 'node', (data) => ({
            'ZEPHYR_SITE_URL': data.url,
            'ZEPHYR_TOKEN': data.token,
            'ZEPHYR_JIRA_PROJECT_KEY': data.projectKey
        }))
    ));

    context.subscriptions.push(vscode.commands.registerCommand('flocca.connectZephyrEnterprise', () =>
        connectWithWebview('zephyr-enterprise', 'zephyr-enterprise', 'resources/servers/zephyr-enterprise/server.js', 'node', (data) => ({
            'ZEPHYR_ENT_BASE_URL': data.url,
            'ZEPHYR_ENT_USERNAME': data.username,
            'ZEPHYR_ENT_TOKEN': data.token,
            'ZEPHYR_ENT_PROJECT_ID': data.project_id || '',
        }))
    ));

    // --- Generic Webview Connection Helper ---
    const connectWithWebview = async (
        provider: string,
        serverName: string,
        serverPath: string,
        runtime: 'node' | 'python3',
        envMapper: (data: any) => Record<string, string>
    ) => {
        if (!subsService.checkAccess(provider)) {
            const selection = await vscode.window.showErrorMessage(`${provider} is a Pro feature and your trial has expired.`, { modal: true }, "Upgrade");
            if (selection === "Upgrade") subsService.upgradeToPro();
            return;
        }

        const { ConnectWebview } = require('./ui/connectWebview');
        ConnectWebview.show(context, provider, async (data: any) => {
            try {
                const configService = new McpConfigService(context);
                const config = await configService.loadConfig();
                if (config) {
                    if (!config.mcpServers[serverName]) {
                        const args = [context.asAbsolutePath(serverPath)];
                        // We set PYTHONUNBUFFERED in env instead of just relying on -u arg
                        const extraEnv: Record<string, string> = {};
                        if (runtime === 'python3') {
                            extraEnv['PYTHONUNBUFFERED'] = '1';
                        }

                        config.mcpServers[serverName] = {
                            command: runtime,
                            args: args,
                            env: extraEnv
                        };
                    }

                    // Merge new env vars with existing ones to preserve other settings if any
                    config.mcpServers[serverName].env = {
                        ...config.mcpServers[serverName].env,
                        ...envMapper(data)
                    };

                    await configService.saveConfig(config);

                    await clientManager.connectLocal(
                        serverName,
                        runtime,
                        [context.asAbsolutePath(serverPath)],
                        config.mcpServers[serverName].env
                    );

                    vscode.commands.executeCommand('setContext', `flocca.connected.${serverName}`, true);
                    await updateState();
                    vscode.window.showInformationMessage(`Successfully connected to ${provider}!`);
                }
            } catch (e: any) {
                vscode.window.showErrorMessage(`Failed to connect ${provider}: ${e.message}`);
            }
        });
    };

    context.subscriptions.push(vscode.commands.registerCommand('flocca.connectStripe', () =>
        connectWithWebview('stripe', 'stripe', 'resources/servers/stripe/server.js', 'node', (data) => ({
            'STRIPE_SECRET_KEY': data.key
        }))
    ));

    context.subscriptions.push(vscode.commands.registerCommand('flocca.connectFigma', () =>
        connectWithWebview('figma', 'figma', 'resources/servers/figma/server.js', 'node', (data) => ({
            'FIGMA_ACCESS_TOKEN': data.token
        }))
    ));

    context.subscriptions.push(vscode.commands.registerCommand('flocca.connectSlack', () =>
        connectWithWebview('slack', 'slack', 'resources/servers/slack/server.js', 'node', (data) => ({
            'SLACK_BOT_TOKEN': data.token
        }))
    ));

    context.subscriptions.push(vscode.commands.registerCommand('flocca.connectGitLab', () =>
        connectWithWebview('gitlab', 'gitlab', 'resources/servers/gitlab/server.js', 'node', (data) => ({
            'GITLAB_TOKEN': data.token,
            'GITLAB_BASE_URL': data.url
        }))
    ));

    context.subscriptions.push(vscode.commands.registerCommand('flocca.connectBitbucket', () =>
        connectWithWebview('bitbucket', 'bitbucket', 'resources/servers/bitbucket/server.js', 'node', (data) => ({
            'BITBUCKET_USERNAME': data.username,
            'BITBUCKET_PASSWORD': data.password,
            'BITBUCKET_WORKSPACE': data.workspace || ''
        }))
    ));

    context.subscriptions.push(vscode.commands.registerCommand('flocca.connectJira', () =>
        connectWithWebview('jira', 'jira', 'resources/servers/jira/server.js', 'node', (data) => ({
            'JIRA_SITE_URL': data.url,
            'JIRA_EMAIL': data.email,
            'JIRA_API_TOKEN': data.token
        }))
    ));

    context.subscriptions.push(vscode.commands.registerCommand('flocca.connectConfluence', () =>
        connectWithWebview('confluence', 'confluence', 'resources/servers/confluence/server.js', 'node', (data) => ({
            'CONFLUENCE_BASE_URL': data.url,
            'CONFLUENCE_USERNAME': data.email,
            'CONFLUENCE_TOKEN': data.token
        }))
    ));

    context.subscriptions.push(vscode.commands.registerCommand('flocca.connectTeams', () =>
        connectWithWebview('teams', 'teams', 'resources/servers/teams/server.js', 'node', (data) => ({
            'TEAMS_TOKEN': data.token,
            'TEAMS_TENANT_ID': data.tenant_id
        }))
    ));

    context.subscriptions.push(vscode.commands.registerCommand('flocca.connectNotion', () =>
        connectWithWebview('notion', 'notion', 'resources/servers/notion/server.js', 'node', (data) => ({
            'NOTION_TOKEN': data.token
        }))
    ));

    context.subscriptions.push(vscode.commands.registerCommand('flocca.connectSentry', () =>
        connectWithWebview('sentry', 'sentry', 'resources/servers/sentry/server.js', 'node', (data) => ({
            'SENTRY_TOKEN': data.token,
            'SENTRY_ORG_SLUG': data.org_slug,
            'SENTRY_BASE_URL': data.base_url
        }))
    ));

    context.subscriptions.push(vscode.commands.registerCommand('flocca.connectGHA', () =>
        connectWithWebview('github_actions', 'github_actions', 'resources/servers/github_actions/server.js', 'node', (data) => ({
            'GITHUB_TOKEN': data.token,
            'GITHUB_OWNER': data.owner,
            'GITHUB_REPO': data.repo
        }))
    ));

    context.subscriptions.push(vscode.commands.registerCommand('flocca.connectGCP', () =>
        connectWithWebview('gcp', 'gcp', 'resources/servers/gcp/server.js', 'node', (data) => ({
            'GCP_PROJECT_ID': data.project_id,
            'GCP_ACCESS_TOKEN': data.token,
            'GCP_REGION': data.region,
            'GCP_ZONE': data.zone
        }))
    ));

    context.subscriptions.push(vscode.commands.registerCommand('flocca.connectAWS', () =>
        connectWithWebview('aws', 'aws', 'resources/servers/aws/server.js', 'node', (data) => ({
            'AWS_ACCESS_KEY_ID': data.access_key,
            'AWS_SECRET_ACCESS_KEY': data.secret_key,
            'AWS_SESSION_TOKEN': data.session_token,
            'AWS_REGION': data.region
        }))
    ));

    context.subscriptions.push(vscode.commands.registerCommand('flocca.connectAzure', () =>
        connectWithWebview('azure', 'azure', 'resources/servers/azure/server.js', 'node', (data) => ({
            'AZURE_SUBSCRIPTION_ID': data.subscription_id,
            'AZURE_ACCESS_TOKEN': data.token,
            'AZURE_TENANT_ID': data.tenant_id
        }))
    ));

    // Azure DevOps (separate from Cloud)
    context.subscriptions.push(vscode.commands.registerCommand('flocca.connectAzureDevOps', () =>
        connectWithWebview('azuredevops', 'azuredevops', 'resources/servers/azuredevops/server.js', 'node', (data) => ({
            'ADO_ORG_URL': data.org_url,
            'ADO_PAT': data.token
        }))
    ));

    context.subscriptions.push(vscode.commands.registerCommand('flocca.connectKubernetes', () =>
        connectWithWebview('kubernetes', 'kubernetes', 'resources/servers/kubernetes/server.js', 'node', (data) => ({
            'KUBECONFIG': data.kubeconfig,
            'K8S_API_SERVER': data.api_server,
            'K8S_TOKEN': data.token
        }))
    ));

    context.subscriptions.push(vscode.commands.registerCommand('flocca.connectDocker', () =>
        connectWithWebview('docker', 'docker', 'resources/servers/docker/server.js', 'node', (data) => ({
            'DOCKER_HOST': data.host
        }))
    ));

    context.subscriptions.push(vscode.commands.registerCommand('flocca.connectElastic', () =>
        connectWithWebview('elastic', 'elastic', 'resources/servers/elastic/server.js', 'node', (data) => ({
            'ELASTIC_URL': data.url,
            'ELASTIC_API_KEY': data.api_key,
            'ELASTIC_USERNAME': data.username,
            'ELASTIC_PASSWORD': data.password,
            'ELASTIC_INDICES': data.indices
        }))
    ));

    context.subscriptions.push(vscode.commands.registerCommand('flocca.connectObservability', () =>
        connectWithWebview('observability', 'observability', 'resources/servers/observability/server.js', 'node', (data) => ({
            'PROMETHEUS_URL': data.prometheus_url,
            'GRAFANA_URL': data.grafana_url,
            'GRAFANA_TOKEN': data.grafana_token
        }))
    ));

    context.subscriptions.push(vscode.commands.registerCommand('flocca.connectPostgres', () =>
        connectWithWebview('postgres', 'postgres', 'resources/servers/db/server.js', 'node', (data) => ({
            'POSTGRES_CONNECTION_STRING': data.connection_string
        }))
    ));

    context.subscriptions.push(vscode.commands.registerCommand('flocca.connectTestRail', () =>
        connectWithWebview('testrail', 'testrail', 'resources/servers/testrail/server.js', 'node', (data) => ({
            'TESTRAIL_URL': data.url,
            'TESTRAIL_USERNAME': data.username,
            'TESTRAIL_API_KEY': data.api_key
        }))
    ));

    context.subscriptions.push(vscode.commands.registerCommand('flocca.connectCypress', () =>
        connectWithWebview('cypress', 'cypress', 'resources/servers/cypress/server.js', 'node', (data) => ({
            'CYPRESS_CONFIG_PATH': data.config_path
        }))
    ));

    context.subscriptions.push(vscode.commands.registerCommand('flocca.connectPytest', () =>
        connectWithWebview('pytest', 'pytest', 'resources/servers/pytest/server.py', 'python3', (data) => ({
            // Optional args can be passed via env or just ignored if server doesn't use them yet
            // The server.py currently doesn't read env for args, but we can store them.
            'PYTEST_ARGS': data.args
        }))
    ));

    context.subscriptions.push(vscode.commands.registerCommand('flocca.connectPlaywright', () =>
        connectWithWebview('playwright', 'playwright', 'resources/servers/playwright/server.js', 'node', (data) => ({
            'PLAYWRIGHT_ARGS': data.args
        }))
    ));

    // Stripe (Checkout/Payment related, not a server here, but user asked)
    // No strict 'stripe' server command exists, only 'upgrade'. User likely meant that.

    // --- Team Commands ---
    context.subscriptions.push(vscode.commands.registerCommand('flocca.createTeam', async () => {
        const name = await vscode.window.showInputBox({ prompt: 'Enter Team Name (e.g. "DevOps Squad")' });
        if (!name) return;

        try {
            const { TeamService } = require('./services/teamService');
            const teamService = new TeamService(context);
            const team = await teamService.createTeam(name);
            vscode.window.showInformationMessage(`Team "${team.name}" created!`);
        } catch (e: any) {
            vscode.window.showErrorMessage(`Failed to create team: ${e.message}`);
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('flocca.joinTeam', async () => {
        const code = await vscode.window.showInputBox({ prompt: 'Enter Invite Code' });
        if (!code) return;

        try {
            const { TeamService } = require('./services/teamService');
            const teamService = new TeamService(context);
            const res = await teamService.joinTeam(code);
            vscode.window.showInformationMessage(`Joined team "${res.team.name}" successfully!`);
        } catch (e: any) {
            vscode.window.showErrorMessage(`Failed to join team: ${e.message}`);
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('flocca.inviteToTeam', async () => {
        try {
            const { TeamService } = require('./services/teamService');
            const teamService = new TeamService(context);
            const teams = await teamService.getMyTeams();

            if (teams.length === 0) {
                vscode.window.showErrorMessage("You don't belong to any teams yet.");
                return;
            }

            interface TeamPickItem extends vscode.QuickPickItem {
                id: string;
            }

            const items: TeamPickItem[] = teams.map((t: any) => ({ label: t.name, id: t.id }));
            const selected = await vscode.window.showQuickPick(items, { placeHolder: 'Select a team to invite members to' });

            if (!selected) return;

            const res = await teamService.createInvite(selected.id);
            await vscode.env.clipboard.writeText(res.code);
            vscode.window.showInformationMessage(`Invite code for ${selected.label} copied to clipboard: ${res.code}`);
        } catch (e: any) {
            vscode.window.showErrorMessage(`Failed to generate invite: ${e.message}`);
        }
    }));

    // --- Auth Commands ---
    context.subscriptions.push(vscode.commands.registerCommand('flocca.login', async () => {
        const email = await vscode.window.showInputBox({ prompt: 'Email Address' });
        if (!email) return;
        const password = await vscode.window.showInputBox({ prompt: 'Password', password: true });
        if (!password) return;

        const authService = new AuthService(context);
        const result = await authService.login(email, password);
        if (result && result.user) {
            const subs = new SubscriptionService(context);
            await subs.setUserId(result.user.id);
            if (result.user.email) await subs.setEmail(result.user.email);

            if (result.user.subscriptionStatus) {
                // Determine if active based on status string
                const isActive = result.user.subscriptionStatus === 'individual' || result.user.subscriptionStatus === 'teams';
                await context.globalState.update('flocca.subscriptionStatus', isActive ? 'active' : undefined);
            }
            subs.updateStatusBar();
            // Refresh Dashboard
            const { DashboardProvider } = require('./ui/chatProvider'); // Ensure we refresh
            // But we can't easily reach the provider instance unless we exported it or use a command.
            // Fortunately `updateState()` touches the provider if we update `extension.ts` logic to include it? 
            // `dashboardProvider` is local in activate.
            // We should rely on `updateState` triggering `dashboardProvider.updateStatus()`.
            // Wait, `updateState` is defined inside activate. We can't call it here easily unless we move it or use a global.
            // Actually, `updateState` IS called in the code right below.
            // We passed `dashboardProvider` to `updateState` locally? No it captured it.
            // This code block is INSIDE activate, so `updateState` is available.

            await updateState();
            vscode.window.showInformationMessage(`Logged in as ${result.user.email}`);
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('flocca.register', async () => {
        // This command might be unused if we switch to Webview payload, but we keep it for now.
        const email = await vscode.window.showInputBox({ prompt: 'Email Address' });
        if (!email) return;
        const password = await vscode.window.showInputBox({ prompt: 'Password', password: true });
        if (!password) return;

        const subs = new SubscriptionService(context);
        const currentAnonId = subs.getUserId();

        const authService = new AuthService(context);
        const result = await authService.register(email, password, currentAnonId);
        if (result && result.user) {
            await subs.setUserId(result.user.id);
            if (result.user.email) await subs.setEmail(result.user.email);

            if (result.user.subscriptionStatus) {
                const isActive = result.user.subscriptionStatus === 'individual' || result.user.subscriptionStatus === 'teams';
                await context.globalState.update('flocca.subscriptionStatus', isActive ? 'active' : undefined);
            }
            subs.updateStatusBar();
            await updateState();
            vscode.window.showInformationMessage(`Registered and claimed account: ${result.user.email}`);
        }
    }));

}

export function deactivate() { }
