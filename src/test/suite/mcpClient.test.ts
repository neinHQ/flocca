import * as assert from 'assert';
import * as vscode from 'vscode';
import { McpClientManager } from '../../services/mcpClientService';
import { SubscriptionService } from '../../services/subscriptionService';
import { TelemetryService } from '../../services/telemetryService';
import * as sinon from 'sinon';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

suite('McpClientManager Test Suite', () => {
    const mockContext = { extensionUri: {} } as vscode.ExtensionContext;

    let mockSubsService: any;
    let mockTelemetryService: any;
    let clientManager: McpClientManager;
    let connectStub: sinon.SinonStub;
    let closeStub: sinon.SinonStub;
    let showInfoStub: sinon.SinonStub;

    setup(() => {
        mockSubsService = {
            checkAccess: sinon.stub().returns(true)
        };
        mockTelemetryService = {
            logUsage: sinon.spy(),
            logError: sinon.spy()
        };
        connectStub = sinon.stub(Client.prototype as any, 'connect').resolves();
        closeStub = sinon.stub(Client.prototype as any, 'close').resolves();
        showInfoStub = sinon.stub(vscode.window, 'showInformationMessage').returns(Promise.resolve(undefined) as any);
        clientManager = new McpClientManager(mockContext, mockSubsService as SubscriptionService, mockTelemetryService as TelemetryService);
    });

    teardown(() => {
        sinon.restore();
    });

    test('callTool throws SUBSCRIPTION_REQUIRED if checkAccess fails', async () => {
        mockSubsService.checkAccess.returns(false);

        try {
            await clientManager.callTool('any_server', 'any_tool', {});
            assert.fail('Should have thrown');
        } catch (e: any) {
            assert.strictEqual(e.message, 'SUBSCRIPTION_REQUIRED');
            assert.strictEqual(mockTelemetryService.logUsage.calledWith('mcp_tool_blocked'), true);
        }
    });

    test('callTool throws Server Not Found if client missing', async () => {
        mockSubsService.checkAccess.returns(true);

        // No clients connected
        try {
            await clientManager.callTool('missing_server', 'tool', {});
            assert.fail('Should have thrown');
        } catch (e: any) {
            assert.ok(e.message.includes('not found'));
            assert.strictEqual(mockTelemetryService.logError.called, true);
        }
    });

    test('connectLocal registers MCP definition and disconnect removes it', async () => {
        let events = 0;
        const disposable = clientManager.onDidChangeMcpServerDefinitions(() => { events += 1; });

        await clientManager.connectLocal('jira', 'node', ['resources/servers/jira/server.js'], { TEST_ENV: '1' });
        assert.strictEqual(connectStub.calledOnce, true);
        assert.strictEqual(clientManager.getConnectedClients().includes('jira'), true);
        assert.strictEqual(clientManager.getMcpServerDefinitions().length, 1);
        assert.strictEqual(events, 1, 'Should emit definition change on local connect');

        await clientManager.disconnect('jira');
        assert.strictEqual(closeStub.calledOnce, true);
        assert.strictEqual(clientManager.getConnectedClients().includes('jira'), false);
        assert.strictEqual(clientManager.getMcpServerDefinitions().length, 0);
        assert.strictEqual(events, 2, 'Should emit definition change on disconnect');

        disposable.dispose();
    });

    test('connectRemote does not register LM MCP server definition yet', async () => {
        let events = 0;
        const disposable = clientManager.onDidChangeMcpServerDefinitions(() => { events += 1; });

        await clientManager.connectRemote('jira', 'https://example.com/sse', {});
        assert.strictEqual(connectStub.calledOnce, true);
        assert.strictEqual(showInfoStub.calledOnce, true);
        assert.strictEqual(clientManager.getConnectedClients().includes('jira'), true);
        assert.strictEqual(clientManager.getMcpServerDefinitions().length, 0, 'Remote SSE servers are intentionally excluded');
        assert.strictEqual(events, 1, 'Should still emit change event for provider refresh');

        disposable.dispose();
    });

    // Note: Testing successful callTool requires mocking the private _clients Map or Client class which is harder.
    // The previous tests cover the critical "Epic 8/9" integration logic in this class.
});
