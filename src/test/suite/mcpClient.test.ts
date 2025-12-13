import * as assert from 'assert';
import * as vscode from 'vscode';
import { McpClientManager } from '../../services/mcpClientService';
import { SubscriptionService } from '../../services/subscriptionService';
import { TelemetryService } from '../../services/telemetryService';
import * as sinon from 'sinon';

suite('McpClientManager Test Suite', () => {
    const mockContext = { extensionUri: {} } as vscode.ExtensionContext;

    let mockSubsService: any;
    let mockTelemetryService: any;
    let clientManager: McpClientManager;

    setup(() => {
        mockSubsService = {
            checkAccess: sinon.stub().returns(true)
        };
        mockTelemetryService = {
            logUsage: sinon.spy(),
            logError: sinon.spy()
        };
        clientManager = new McpClientManager(mockContext, mockSubsService as SubscriptionService, mockTelemetryService as TelemetryService);
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

    // Note: Testing successful callTool requires mocking the private _clients Map or Client class which is harder.
    // The previous tests cover the critical "Epic 8/9" integration logic in this class.
});
