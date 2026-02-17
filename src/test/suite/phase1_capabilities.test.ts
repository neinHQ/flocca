import * as assert from 'assert';
import * as vscode from 'vscode';
import { SubscriptionService } from '../../services/subscriptionService';

suite('Phase 1 Capability Gating', () => {
    const mockState = new Map<string, any>();
    const mockContext = {
        globalState: {
            get: (key: string) => mockState.get(key),
            update: async (key: string, value: any) => mockState.set(key, value)
        }
    } as unknown as vscode.ExtensionContext;

    setup(() => {
        mockState.clear();
    });

    test('expired users keep free capabilities only', async () => {
        const service = new SubscriptionService(mockContext);
        await service.expireTrial();

        assert.strictEqual(service.getStatus(), 'expired');
        assert.strictEqual(service.checkAccess('github'), true);
        assert.strictEqual(service.checkAccess('codebase'), true);
        assert.strictEqual(service.checkAccess('pytest'), true);
        assert.strictEqual(service.checkAccess('playwright'), true);

        assert.strictEqual(service.checkAccess('jira'), false);
        assert.strictEqual(service.checkAccess('mcp_tool:jira'), false);
        assert.strictEqual(service.checkAccess('mcp_tool:github'), true);
    });

    test('active users can access pro connector/tool capabilities', () => {
        const service = new SubscriptionService(mockContext);

        assert.strictEqual(service.getStatus(), 'active');
        assert.strictEqual(service.checkAccess('jira'), true);
        assert.strictEqual(service.checkAccess('mcp_tool:jira'), true);
    });

    test('expired users can still call free MCP tool servers', async () => {
        const service = new SubscriptionService(mockContext);
        await service.expireTrial();

        assert.strictEqual(service.checkAccess('mcp_tool:github'), true);
        assert.strictEqual(service.checkAccess('mcp_tool:codebase'), true);
        assert.strictEqual(service.checkAccess('mcp_tool:pytest'), true);
        assert.strictEqual(service.checkAccess('mcp_tool:playwright'), true);
    });

    test('unknown features and MCP servers default to Pro capability', async () => {
        const service = new SubscriptionService(mockContext);
        await service.expireTrial();

        assert.strictEqual(service.checkAccess('unknown_connector'), false);
        assert.strictEqual(service.checkAccess('mcp_tool:unknown_server'), false);
    });

    test('entitlements override local trial status', async () => {
        const service = new SubscriptionService(mockContext);
        await service.expireTrial();
        assert.strictEqual(service.getStatus(), 'expired');

        await service.applyEntitlements({
            planTier: 'enterprise',
            capabilities: ['free.github', 'free.codebase', 'free.testing', 'pro.connectors', 'pro.tools', 'enterprise.sso']
        });

        assert.strictEqual(service.checkAccess('jira'), true);
        assert.strictEqual(service.checkAccess('mcp_tool:jira'), true);
        assert.strictEqual(service.isPaidUser(), true);
    });
});
