import { McpConfig } from './mcpConfigService';

export type DisconnectChoice = 'cancel' | 'disconnect' | 'disconnectAndRemove';
export type DisconnectResult =
    | 'invalid'
    | 'not_connected'
    | 'cancelled'
    | 'disconnected_soft'
    | 'disconnected_removed'
    | 'error';

export interface DisconnectServiceDeps {
    getConnectedClients(): string[];
    disconnect(serverName: string): Promise<void>;
    markDisconnected(serverName: string): Promise<void>;
    setConnectedContext(serverName: string, connected: boolean): Promise<void>;
    refreshDashboard(): void;
    chooseDisconnect(serverName: string): Promise<DisconnectChoice>;
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    loadConfig(): Promise<McpConfig | undefined>;
    saveConfig(config: McpConfig): Promise<void>;
}

export async function disconnectServerFlow(serverName: string, deps: DisconnectServiceDeps): Promise<DisconnectResult> {
    const normalizedServerName = String(serverName || '').trim();
    if (!normalizedServerName) {
        deps.warn('Invalid server id for disconnect.');
        return 'invalid';
    }

    const connected = deps.getConnectedClients();
    if (!connected.includes(normalizedServerName)) {
        deps.refreshDashboard();
        deps.info(`${normalizedServerName} is not currently connected.`);
        return 'not_connected';
    }

    const choice = await deps.chooseDisconnect(normalizedServerName);
    if (choice === 'cancel') {
        return 'cancelled';
    }

    try {
        await deps.disconnect(normalizedServerName);
        await deps.markDisconnected(normalizedServerName);
        await deps.setConnectedContext(normalizedServerName, false);

        if (choice === 'disconnectAndRemove') {
            const config = await deps.loadConfig();
            if (config?.servers?.[normalizedServerName]) {
                delete config.servers[normalizedServerName];
                await deps.saveConfig(config);
            }
            deps.refreshDashboard();
            deps.info(`Disconnected ${normalizedServerName} and removed it from MCP config.`);
            return 'disconnected_removed';
        }

        deps.refreshDashboard();
        deps.info(`Disconnected from ${normalizedServerName}. Use Connect to reconnect.`);
        return 'disconnected_soft';
    } catch (e: any) {
        deps.refreshDashboard();
        deps.error(`Failed to disconnect ${normalizedServerName}: ${e?.message || String(e)}`);
        return 'error';
    }
}
