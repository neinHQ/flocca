import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { SubscriptionService } from '../../services/subscriptionService';

suite('SubscriptionService Recent Changes', () => {
    let sandbox: sinon.SinonSandbox;
    let mockState: Map<string, any>;
    let mockContext: vscode.ExtensionContext;

    setup(() => {
        sandbox = sinon.createSandbox();
        mockState = new Map<string, any>();
        mockState.set('flocca.userId', 'user_123');
        mockState.set('flocca.subscriptionStatus', 'active');
        mockState.set('flocca.email', 'paid@flocca.app');
        mockState.set('flocca.entitlements', { planTier: 'team', capabilities: ['pro.connectors'] });

        mockContext = {
            globalState: {
                get: (key: string) => mockState.get(key),
                update: async (key: string, value: any) => { mockState.set(key, value); }
            }
        } as unknown as vscode.ExtensionContext;

        sandbox.stub(vscode.window, 'createStatusBarItem').returns({
            command: '',
            text: '',
            tooltip: '',
            backgroundColor: undefined,
            show: () => { },
            hide: () => { },
            dispose: () => { }
        } as unknown as vscode.StatusBarItem);
    });

    teardown(() => {
        sandbox.restore();
    });

    test('upgradeToPlan opens pricing with minimum seats for teams', async () => {
        const openExternalStub = sandbox.stub(vscode.env, 'openExternal').resolves(true);
        const service = new SubscriptionService(mockContext);

        await service.upgradeToPlan('teams');

        assert.ok(openExternalStub.calledOnce);
        const uri = openExternalStub.firstCall.args[0] as vscode.Uri;
        const url = uri.toString();
        assert.ok(url.includes('plan=teams'));
        assert.ok(url.includes('quantity=3'));
        assert.ok(url.includes('userId=user_123'));
    });

    test('upgradeToPlan opens pricing with minimum seats for enterprise', async () => {
        const openExternalStub = sandbox.stub(vscode.env, 'openExternal').resolves(true);
        const service = new SubscriptionService(mockContext);

        await service.upgradeToPlan('enterprise');

        assert.ok(openExternalStub.calledOnce);
        const uri = openExternalStub.firstCall.args[0] as vscode.Uri;
        const url = uri.toString();
        assert.ok(url.includes('plan=enterprise'));
        assert.ok(url.includes('quantity=10'));
        assert.ok(url.includes('userId=user_123'));
    });

    test('openCancelSubscriptionPage opens cancel management URL', async () => {
        const openExternalStub = sandbox.stub(vscode.env, 'openExternal').resolves(true);
        const service = new SubscriptionService(mockContext);

        await service.openCancelSubscriptionPage();

        assert.ok(openExternalStub.calledOnce);
        const uri = openExternalStub.firstCall.args[0] as vscode.Uri;
        const url = uri.toString();
        assert.ok(url.includes('manage=1'));
        assert.ok(url.includes('action=cancel'));
        assert.ok(url.includes('userId=user_123'));
    });

    test('clearSession removes user session fields and rotates user id', async () => {
        const service = new SubscriptionService(mockContext);
        const originalUserId = service.getUserId();

        await service.clearSession();

        assert.strictEqual(mockState.get('flocca.email'), undefined);
        assert.strictEqual(mockState.get('flocca.subscriptionStatus'), undefined);
        assert.strictEqual(mockState.get('flocca.entitlements'), undefined);
        const nextUserId = mockState.get('flocca.userId');
        assert.ok(typeof nextUserId === 'string' && nextUserId.length > 0);
        assert.notStrictEqual(nextUserId, originalUserId);
        assert.ok(typeof mockState.get('flocca.trialStartDate') === 'number');
    });
});
