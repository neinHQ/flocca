import * as assert from 'assert';
import * as vscode from 'vscode';
import { TelemetryService } from '../../services/telemetryService';
import * as sinon from 'sinon';

suite('TelemetryService Test Suite', () => {
    // Mock Context
    const mockState = new Map<string, any>();
    const mockContext = {
        globalState: {
            get: (key: string) => mockState.get(key),
            update: async (key: string, value: any) => mockState.set(key, value)
        }
    } as unknown as vscode.ExtensionContext;

    // Mock OutputChannel
    let loggedLines: string[] = [];
    const mockChannel = {
        appendLine: (line: string) => loggedLines.push(line),
        show: () => { },
        dispose: () => { }
    } as unknown as vscode.OutputChannel;

    let createOutputChannelStub: sinon.SinonStub;

    setup(() => {
        mockState.clear();
        loggedLines = [];
        createOutputChannelStub = sinon.stub(vscode.window, 'createOutputChannel').returns(mockChannel as any);
    });

    teardown(() => {
        createOutputChannelStub.restore();
    });

    test('Logs usage anonymized', async () => {
        mockState.set('flocca.userId', 'test-uuid-123');
        const service = new TelemetryService(mockContext);

        service.logUsage('test_event', { foo: 'bar' });

        assert.strictEqual(loggedLines.length, 1);
        const log = JSON.parse(loggedLines[0]);
        assert.strictEqual(log.type, 'Usage');
        assert.strictEqual(log.event, 'test_event');
        assert.strictEqual(log.user, 'test-uuid-123');
        assert.strictEqual(log.foo, 'bar');
    });

    // Note: Testing opt-out requires mocking vscode.workspace.getConfiguration
    // which is harder without full VS Code instance or complex Sinon stubs.
    // We assume default enabled = true for this unit test.
});
