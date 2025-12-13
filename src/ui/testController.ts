import * as vscode from 'vscode';
import { McpClientManager } from '../services/mcpClientService';

export function setupTestController(context: vscode.ExtensionContext, clientManager: McpClientManager) {
    const controller = vscode.tests.createTestController('floccaPytest', 'Flocca Pytest');
    context.subscriptions.push(controller);

    controller.resolveHandler = async (item) => {
        if (!item) {
            // Root discovery
            // In a real app, we'd call 'pytest.discover' tool (not implemented yet), or parse local files.
            // For MVP, we'll wait for a run to populate, OR add a generic "Run All" node.
            const root = controller.createTestItem('root', 'All Tests', undefined);
            controller.items.add(root);
        }
    };

    const runProfile = controller.createRunProfile('Run Pytest', vscode.TestRunProfileKind.Run, async (request, token) => {
        const run = controller.createTestRun(request);
        const queue: vscode.TestItem[] = [];

        if (request.include) {
            request.include.forEach(test => queue.push(test));
        } else {
            controller.items.forEach(test => queue.push(test));
        }

        // Trigger MCP Call
        try {
            run.appendOutput('Starting Pytest via MCP...\r\n');
            // Assuming we run ALL for simplicity if root is selected
            // We need query params to run specific tests. For now: Run ALL.
            const result: any = await clientManager.callTool('pytest', 'pytest.runAll', {});

            // Output usually in result.content[0].text. 
            // If we used --json-report, we might parse it. 
            // Pytest stdout is unstructured unless we stick to JSON.
            // The python server I wrote returns stdout/stderr text.

            const output = result?.content?.[0]?.text || "";
            run.appendOutput(output.replace(/\n/g, '\r\n'));

            // Rudimentary parsing of Pytest output to mark status (MVP)
            if (output.includes('failed') || output.includes('ERRORS')) {
                // We don't have individual test mapping yet without structured JSON.
                // So we mark the "Root" as failed if we can find it.
                const root = controller.items.get('root');
                if (root) run.failed(root, new vscode.TestMessage('Pytest run failed. Check output.'));
            } else if (output.includes('passed')) {
                const root = controller.items.get('root');
                if (root) run.passed(root);
            }

        } catch (e) {
            run.appendOutput(`Error: ${e}\r\n`);
        }

        run.end();
    });
}
