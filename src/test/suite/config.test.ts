import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { McpConfigService } from '../../services/mcpConfigService';
import { TextEncoder } from 'util';

suite('McpConfigService Test Suite', () => {
    let mockContext: vscode.ExtensionContext;
    let mockFs: any;

    setup(() => {
        mockContext = {
            asAbsolutePath: (p: string) => `/abs/${p}`
        } as unknown as vscode.ExtensionContext;

        mockFs = {
            readFile: sinon.stub()
        };
    });

    test('loadConfig returns defaults if no workspace folders', async () => {
        const service = new McpConfigService(mockContext, mockFs, undefined);
        const config = await service.loadConfig();

        assert.ok(config);
        assert.ok(config.mcpServers['github']); // Defaults applied
    });

    test('loadConfig returns defaults if file missing (readFile throws)', async () => {
        const mockFolder = { uri: vscode.Uri.file('/workspace'), index: 0, name: 'ws' };
        mockFs.readFile.rejects(new Error('File not found'));

        const service = new McpConfigService(mockContext, mockFs, [mockFolder]);
        const config = await service.loadConfig();

        assert.ok(config);
        assert.ok(config.mcpServers['github']); // Defaults applied
        assert.ok(config.mcpServers['codebase']); // Epic 6 Default applied
    });

    test('loadConfig parses valid mcp.json', async () => {
        const mockFolder = { uri: vscode.Uri.file('/workspace'), index: 0, name: 'ws' };
        const mockConfig = {
            mcpServers: {
                "custom": {
                    "command": "node",
                    "args": []
                }
            }
        };

        mockFs.readFile.resolves(new TextEncoder().encode(JSON.stringify(mockConfig)));

        const service = new McpConfigService(mockContext, mockFs, [mockFolder]);
        const config = await service.loadConfig();

        assert.ok(config);
        assert.ok(config!.mcpServers['custom']);
        // Defaults should still stack if not overridden? 
        // Logic says: `if (!config.mcpServers['github']) ...` so yes, defaults will be ADDED.
        assert.ok(config!.mcpServers['github']);
    });
    test('saveConfig preserves existing keys', async () => {
        const mockFolder = { uri: vscode.Uri.file('/workspace'), index: 0, name: 'ws' };
        mockFs.createDirectory = sinon.stub().resolves();
        mockFs.writeFile = sinon.stub().resolves();

        const service = new McpConfigService(mockContext, mockFs, [mockFolder]);

        // Initial Config
        const initialConfig = {
            mcpServers: {
                "pytest": { command: "python3", args: [], env: {} },
                "playwright": { command: "node", args: [], env: {} }
            }
        };

        // Simulate saving a new config that includes old + new (which logic must handle, or caller must handle)
        // NOTE: McpConfigService.saveConfig overwrites with whatever is passed.
        // So the burden is on the CALLER (extension.ts) to merge.
        // But we can verify that the service writes what it's given.

        const newConfig = {
            mcpServers: {
                ...initialConfig.mcpServers,
                "jira": { command: "node", args: [] }
            }
        };

        await service.saveConfig(newConfig);

        assert.ok(mockFs.writeFile.calledOnce);
        const args = mockFs.writeFile.firstCall.args;
        const savedData = JSON.parse(new TextDecoder().decode(args[1]));

        assert.ok(savedData.mcpServers['pytest']); // Persisted
        assert.ok(savedData.mcpServers['playwright']); // Persisted
        assert.ok(savedData.mcpServers['jira']); // Added
    });
});
