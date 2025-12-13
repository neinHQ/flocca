import * as assert from 'assert';
import * as vscode from 'vscode';
import { SubscriptionService } from '../../services/subscriptionService';

suite('SubscriptionService Test Suite', () => {
    // Mock Context
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

    test('Initial status should be Trial (active)', async () => {
        const service = new SubscriptionService(mockContext);
        assert.strictEqual(service.getStatus(), 'active');
        assert.strictEqual(service.checkAccess('any_feature'), true);
    });

    test('Trial expiry', async () => {
        const service = new SubscriptionService(mockContext);

        // Manually expire trial
        await service.expireTrial();

        assert.strictEqual(service.getStatus(), 'expired');
        assert.strictEqual(service.checkAccess('any_feature'), false);
    });

    test('Upgrade to Pro', async () => {
        const service = new SubscriptionService(mockContext);
        await service.expireTrial();
        assert.strictEqual(service.getStatus(), 'expired');

        await service.upgradeToPro();
        assert.strictEqual(service.getStatus(), 'active');
        assert.strictEqual(service.checkAccess('any_feature'), true);
    });
});
