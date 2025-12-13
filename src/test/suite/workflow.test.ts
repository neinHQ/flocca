import * as assert from 'assert';
import * as vscode from 'vscode';
import { WorkflowService, Workflow } from '../../services/workflowService';
import { McpClientManager } from '../../services/mcpClientService';
import { TelemetryService } from '../../services/telemetryService';
import * as sinon from 'sinon';

suite('WorkflowService Test Suite', () => {
    const mockContext = { extensionUri: {} } as vscode.ExtensionContext;

    // Mock Dependencies
    const mockClientManager = {
        callTool: sinon.stub().resolves({ content: [{ text: 'Tool Result' }] })
    } as unknown as McpClientManager;

    const mockTelemetry = {
        logUsage: sinon.spy()
    } as unknown as TelemetryService;

    test('Execute Workflow calls tools sequentially', async () => {
        const service = new WorkflowService(mockContext, mockClientManager, mockTelemetry);

        const workflow: Workflow = {
            name: 'Test Flow',
            steps: [
                { id: '1', serverName: 'srv1', toolName: 'tool1', arguments: {} },
                { id: '2', serverName: 'srv1', toolName: 'tool2', arguments: {} }
            ]
        };

        const logs: string[] = [];
        await service.executeWorkflow(workflow, (msg) => logs.push(msg));

        // Check Execution
        assert.strictEqual((mockClientManager.callTool as sinon.SinonStub).callCount, 2);
        assert.strictEqual(logs[0], 'Starting Workflow: Test Flow');

        // Check Telemetry
        assert.strictEqual((mockTelemetry.logUsage as sinon.SinonSpy).calledWith('workflow_execution'), true);
    });
});
