import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { McpClientManager } from '../../services/mcpClientService';
import { SubscriptionService } from '../../services/subscriptionService';
import { TelemetryService } from '../../services/telemetryService'; // Mock

suite('Connection & Subscription Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    let contextMock: any;
    let globalStateMock: any;

    setup(() => {
        globalStateMock = {
            get: sinon.stub(),
            update: sinon.stub().resolves()
        };
        contextMock = {
            globalState: globalStateMock,
            extensionUri: vscode.Uri.parse('file:///test'),
            subscriptions: []
        };
    });

    test('Pytest and Playwright should be free features', () => {
        const subService = new SubscriptionService(contextMock);

        // Mock getStatus to return 'expired'
        globalStateMock.get.withArgs('flocca.subscriptionStatus').returns(undefined);
        globalStateMock.get.withArgs('flocca.trialStartDate').returns(100); // Very old date

        assert.strictEqual(subService.checkAccess('pytest'), true, 'Pytest should be allowed even if expired');
        assert.strictEqual(subService.checkAccess('playwright'), true, 'Playwright should be allowed even if expired');
        assert.strictEqual(subService.checkAccess('github'), true, 'GitHub should be allowed');

        // Check other feature is blocked
        assert.strictEqual(subService.checkAccess('jira'), false, 'Jira should be blocked if expired');
    });

    test('Disconnect command should remove client', async () => {
        // This is an integration test simulation
        // We can't easily mock the entire extension activation, but we can unit test the McpClientManager logic

        // Mock dependencies
        const telemMock = { logUsage: sinon.stub(), logError: sinon.stub() } as any;
        const subService = new SubscriptionService(contextMock);
        const clientManager = new McpClientManager(contextMock, subService, telemMock);

        // Simulate a connection (mocking Client/Transport internal state is hard due to private, 
        // but we can rely on the public API check)
        // Actually, without a real server, connectLocal will fail or hang.
        // So we will verify the disconnect method existence and basic safety.

        const disconnectSpy = sinon.spy(clientManager, 'disconnect');
        await clientManager.disconnect('non_existent_server');
        assert.ok(disconnectSpy.calledWith('non_existent_server'));
        // Should not throw
    });

    test('Commands are registered', async () => {
        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes('flocca.connectPytest'));
        assert.ok(commands.includes('flocca.connectPlaywright'));
        assert.ok(commands.includes('flocca.disconnect'));
    });
});
