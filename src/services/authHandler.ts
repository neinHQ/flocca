
import * as vscode from 'vscode';
import { McpClientManager } from './mcpClientService';
import { SubscriptionService } from './subscriptionService';
import { AuthService } from './authService';

export class AuthUriHandler implements vscode.UriHandler {
    constructor(
        private context: vscode.ExtensionContext,
        private clientManager: McpClientManager,
        private subsService: SubscriptionService
    ) { }

    async handleUri(uri: vscode.Uri): Promise<void> {
        if (uri.path === '/auth-callback') {
            const query = new URLSearchParams(uri.query);
            const service = query.get('service');
            const payloadStr = query.get('payload');

            if (!service || !payloadStr) {
                vscode.window.showErrorMessage('Invalid Auth Callback: Missing fields');
                return;
            }

            try {
                const data = JSON.parse(decodeURIComponent(payloadStr));
                await this.handleConnection(service, data);
            } catch (e) {
                vscode.window.showErrorMessage(`Auth Failed: ${e}`);
            }
        }
    }

    private async handleConnection(service: string, data: any) {
        // Enforce Pro Gate (Double check)
        // Zephyr, Figma usually Pro.
        // We can check access again here just in case.
        if (['zephyr', 'figma', 'jira'].includes(service)) {
            if (!this.subsService.checkAccess(service)) {
                // Should have been gated before opening browser, but handle edge case
                vscode.window.showErrorMessage(`Cannot connect ${service}: Trial Expired/Pro Required.`);
                return;
            }
        }

        const authService = new AuthService(this.context);

        switch (service) {
            case 'zephyr':
                await authService.storeAtlassianToken(data.token);
                await this.clientManager.connectLocal('zephyr', 'node', [this.context.asAbsolutePath('resources/servers/zephyr/server.js')], {
                    ZEPHYR_SITE_URL: data.site,
                    ZEPHYR_TOKEN: data.token,
                    ZEPHYR_PROJECT_KEY: data.projectKey
                });
                vscode.commands.executeCommand('setContext', 'flocca.connected.zephyr', true);
                break;

            case 'figma':
                await authService.storeFigmaToken(data.token);
                await this.clientManager.connectLocal('figma', 'node', [this.context.asAbsolutePath('resources/servers/figma/server.js')], {
                    FIGMA_TOKEN: data.token
                });
                vscode.commands.executeCommand('setContext', 'flocca.connected.figma', true);
                break;

            case 'jira':
                await authService.storeAtlassianToken(data.token);
                await this.clientManager.connectLocal('jira', 'node', [this.context.asAbsolutePath('resources/servers/jira/server.js')], {
                    JIRA_EMAIL: data.email,
                    JIRA_TOKEN: data.token,
                    JIRA_URL: data.site
                });
                vscode.commands.executeCommand('setContext', 'flocca.connected.jira', true);
                break;

            default:
                vscode.window.showErrorMessage(`Unknown Service for Auth: ${service}`);
                return;
        }

        vscode.window.showInformationMessage(`Successfully connected to ${service}!`);
        // Trigger dashboard update if DashboardProvider/Status needs refresh
        vscode.commands.executeCommand('flocca.dashboard.refreshStatus'); // We might need to implement this command or rely on periodic poll
    }
}
