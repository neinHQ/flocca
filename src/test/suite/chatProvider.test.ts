import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { DashboardProvider } from '../../ui/chatProvider';
import { McpClientManager } from '../../services/mcpClientService';

suite('DashboardProvider Test Suite', () => {
    let sandbox: sinon.SinonSandbox;
    let provider: DashboardProvider;
    let mockClientManager: any;
    let mockContext: any;
    let mockWebviewView: any;
    let mockWebview: any;
    let onDidReceiveMessageCallback: (data: any) => void;

    setup(() => {
        sandbox = sinon.createSandbox();

        // 1. Mock McpClientManager
        mockClientManager = {
            getClient: sandbox.stub().returns(undefined), // Default disconnected
            getConnectedClients: sandbox.stub().returns([])
        };

        // 2. Mock Context for Subscription
        mockContext = {
            globalState: {
                get: sandbox.stub().returns('active') // Default Paid
            }
        };

        // 3. Mock Webview
        onDidReceiveMessageCallback = () => { };
        mockWebview = {
            options: {},
            html: '',
            onDidReceiveMessage: (cb: any) => { onDidReceiveMessageCallback = cb; },
            postMessage: sandbox.spy()
        };

        mockWebviewView = {
            webview: mockWebview
        };

        // 4. Create Provider
        // @ts-ignore
        provider = new DashboardProvider(vscode.Uri.parse('file:///tmp'), mockClientManager as McpClientManager, mockContext);
    });

    teardown(() => {
        sandbox.restore();
    });

    test('updateStatus sends correct paid/connected status', async () => {
        // Setup connected state
        mockClientManager.getConnectedClients.returns(['github']);

        // Resolve view
        // @ts-ignore
        provider.resolveWebviewView(mockWebviewView, {}, {});

        // Trigger update
        await provider.updateStatus();

        // Assert
        assert.ok(mockWebview.postMessage.called);
        const args = mockWebview.postMessage.lastCall.args[0];
        assert.strictEqual(args.type, 'updateStatus');
        assert.ok(args.status.connectedServers.includes('github'));
        assert.strictEqual(args.status.isPaid, true);
    });

    test('connectCommand message triggers command', async () => {
        const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand');

        // Resolve view
        // @ts-ignore
        provider.resolveWebviewView(mockWebviewView, {}, {});

        // Simulate Message
        await onDidReceiveMessageCallback({ type: 'connectCommand', command: 'flocca.connectGitHub' });

        // Assert
        assert.ok(executeCommandStub.calledWith('flocca.connectGitHub'));
    });
});
