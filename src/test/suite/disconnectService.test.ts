import * as assert from 'assert';
import { disconnectServerFlow, DisconnectChoice, DisconnectServiceDeps } from '../../services/disconnectService';

suite('DisconnectService Test Suite', () => {
    const buildDeps = (overrides: Partial<DisconnectServiceDeps> = {}): DisconnectServiceDeps => {
        let config = { servers: { github: { command: 'node', args: ['x.js'] } } };
        return {
            getConnectedClients: () => ['github'],
            disconnect: async () => { },
            markDisconnected: async () => { },
            setConnectedContext: async () => { },
            refreshDashboard: () => { },
            chooseDisconnect: async () => 'disconnect' as DisconnectChoice,
            info: () => { },
            warn: () => { },
            error: () => { },
            loadConfig: async () => config,
            saveConfig: async (next) => { config = next as any; },
            ...overrides
        };
    };

    test('returns cancelled and does not disconnect when user cancels', async () => {
        let disconnected = false;
        const deps = buildDeps({
            chooseDisconnect: async () => 'cancel',
            disconnect: async () => { disconnected = true; }
        });

        const result = await disconnectServerFlow('github', deps);
        assert.strictEqual(result, 'cancelled');
        assert.strictEqual(disconnected, false);
    });

    test('soft disconnect does not remove from config', async () => {
        let saved = false;
        const deps = buildDeps({
            chooseDisconnect: async () => 'disconnect',
            saveConfig: async () => { saved = true; }
        });

        const result = await disconnectServerFlow('github', deps);
        assert.strictEqual(result, 'disconnected_soft');
        assert.strictEqual(saved, false);
    });

    test('hard disconnect removes server from config', async () => {
        let savedConfig: any = undefined;
        const deps = buildDeps({
            chooseDisconnect: async () => 'disconnectAndRemove',
            saveConfig: async (cfg) => { savedConfig = cfg; }
        });

        const result = await disconnectServerFlow('github', deps);
        assert.strictEqual(result, 'disconnected_removed');
        assert.ok(savedConfig);
        assert.strictEqual(savedConfig.servers.github, undefined);
    });

    test('stale server returns not_connected and refreshes dashboard', async () => {
        let refreshed = 0;
        const deps = buildDeps({
            getConnectedClients: () => [],
            refreshDashboard: () => { refreshed += 1; }
        });

        const result = await disconnectServerFlow('github', deps);
        assert.strictEqual(result, 'not_connected');
        assert.strictEqual(refreshed, 1);
    });
});
