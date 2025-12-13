import * as assert from 'assert';
import * as sinon from 'sinon';
import { WorkflowService, Workflow } from '../../services/workflowService';
import { McpClientManager } from '../../services/mcpClientService';
import { TelemetryService } from '../../services/telemetryService';

suite('Workflow Engine Test Suite', () => {
    let sandbox: sinon.SinonSandbox;
    let service: WorkflowService;
    let mockClientManager: any;
    let mockTelemetry: any;
    let mockContext: any;

    setup(() => {
        sandbox = sinon.createSandbox();

        mockClientManager = {
            callTool: sandbox.stub()
        };
        mockTelemetry = {
            logUsage: sandbox.stub()
        };
        mockContext = {};

        service = new WorkflowService(mockContext, mockClientManager, mockTelemetry);
    });

    teardown(() => {
        sandbox.restore();
    });

    test('should interpolate variables from previous steps', async () => {
        const workflow: Workflow = {
            name: 'Test Flow',
            steps: [
                {
                    id: 'step1',
                    serverName: 'test-server',
                    toolName: 'get_name',
                    arguments: {}
                },
                {
                    id: 'step2',
                    serverName: 'test-server',
                    toolName: 'greet',
                    arguments: { message: 'Hello ${step1.text}' }
                }
            ]
        };

        // Mock Step 1 Output
        mockClientManager.callTool.withArgs('test-server', 'get_name', sinon.match.any)
            .resolves({ content: [{ type: 'text', text: 'Alice' }] });

        // Mock Step 2 Output
        mockClientManager.callTool.withArgs('test-server', 'greet', sinon.match.any)
            .resolves({ content: [{ type: 'text', text: 'Success' }] });

        const logSpy = sandbox.spy();
        await service.executeWorkflow(workflow, logSpy);

        // Verify Step 2 received 'Alice'
        assert.ok(mockClientManager.callTool.calledTwice);
        const secondCallArgs = mockClientManager.callTool.secondCall.args[2];
        assert.deepStrictEqual(secondCallArgs, { message: 'Hello Alice' });
    });

    test('should access nested JSON results', async () => {
        const workflow: Workflow = {
            name: 'Nested Flow',
            steps: [
                { id: 'json', serverName: 's', toolName: 'get_json', arguments: {} },
                { id: 'use', serverName: 's', toolName: 'use_val', arguments: { val: '${json.result.data.id}' } }
            ]
        };

        // Mock Step 1 returns raw object as result (simulating internal result structure)
        // Note: Our code stores result: rawResult. So to access result.data.id, rawResult must have data.id.
        const mockJson = { data: { id: 123 } };
        mockClientManager.callTool.withArgs('s', 'get_json').resolves(mockJson);
        mockClientManager.callTool.withArgs('s', 'use_val').resolves({ content: [] });

        await service.executeWorkflow(workflow, () => { });

        const useArgs = mockClientManager.callTool.secondCall.args[2];
        assert.strictEqual(useArgs.val, '123');
    });

    test('should halt on error', async () => {
        const workflow: Workflow = {
            name: 'Fail Flow',
            steps: [
                { id: 'step1', serverName: 's', toolName: 'fail', arguments: {} },
                { id: 'step2', serverName: 's', toolName: 'skip', arguments: {} }
            ]
        };

        mockClientManager.callTool.withArgs('s', 'fail').rejects(new Error('Boom'));

        try {
            await service.executeWorkflow(workflow, () => { });
            assert.fail('Should have thrown');
        } catch (e: any) {
            assert.strictEqual(e.message, 'Boom');
        }

        assert.ok(mockClientManager.callTool.calledOnce, 'Should not run step 2');
    });
});
