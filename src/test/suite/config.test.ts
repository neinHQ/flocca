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
        assert.ok(config.servers['github']); // Defaults applied
    });

    test('loadConfig returns defaults if file missing (readFile throws)', async () => {
        const mockFolder = { uri: vscode.Uri.file('/workspace'), index: 0, name: 'ws' };
        mockFs.readFile.rejects(new Error('File not found'));

        const service = new McpConfigService(mockContext, mockFs, [mockFolder]);
        const config = await service.loadConfig();

        assert.ok(config);
        assert.ok(config.servers['github']); // Defaults applied
        assert.ok(config.servers['codebase']); // Epic 6 Default applied
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
        assert.ok(config!.servers['custom']);
        // Defaults should still stack if not overridden? 
        // Logic says: `if (!config.servers['github']) ...` so yes, defaults will be ADDED.
        assert.ok(config!.servers['github']);
    });
    test('loadConfig parses VS Code servers format', async () => {
        const mockFolder = { uri: vscode.Uri.file('/workspace'), index: 0, name: 'ws' };
        const mockConfig = {
            servers: {
                "custom": {
                    "type": "stdio",
                    "command": "node",
                    "args": []
                }
            }
        };

        mockFs.readFile.resolves(new TextEncoder().encode(JSON.stringify(mockConfig)));

        const service = new McpConfigService(mockContext, mockFs, [mockFolder]);
        const config = await service.loadConfig();

        assert.ok(config);
        assert.ok(config!.servers['custom']);
        assert.ok(config!.servers['codebase']);
    });

    test('loadConfig prefers servers when both servers and mcpServers exist', async () => {
        const mockFolder = { uri: vscode.Uri.file('/workspace'), index: 0, name: 'ws' };
        const mixedConfig = {
            mcpServers: {
                jira: { command: 'legacy-node' },
                legacyOnly: { command: 'legacy-only-node' }
            },
            servers: {
                jira: { type: 'stdio', command: 'canonical-node' },
                serversOnly: { type: 'stdio', command: 'servers-only-node' }
            }
        };

        mockFs.readFile.resolves(new TextEncoder().encode(JSON.stringify(mixedConfig)));

        const service = new McpConfigService(mockContext, mockFs, [mockFolder]);
        const config = await service.loadConfig();

        assert.ok(config);
        assert.strictEqual(config!.servers['jira'].command, 'canonical-node', 'servers entry should win on key conflicts');
        assert.ok(config!.servers['legacyOnly'], 'legacy-only keys should still be retained');
        assert.ok(config!.servers['serversOnly'], 'servers-only keys should be retained');
    });
    test('saveConfig preserves existing keys', async () => {
        const mockFolder = { uri: vscode.Uri.file('/workspace'), index: 0, name: 'ws' };
        mockFs.createDirectory = sinon.stub().resolves();
        mockFs.writeFile = sinon.stub().resolves();

        const service = new McpConfigService(mockContext, mockFs, [mockFolder]);

        // Initial Config
        const initialConfig = {
            servers: {
                "pytest": { command: "python3", args: [], env: {} },
                "playwright": { command: "node", args: [], env: {} }
            }
        };

        // Simulate saving a new config that includes old + new (which logic must handle, or caller must handle)
        // NOTE: McpConfigService.saveConfig overwrites with whatever is passed.
        // So the burden is on the CALLER (extension.ts) to merge.
        // But we can verify that the service writes what it's given.

        const newConfig = {
            servers: {
                ...initialConfig.servers,
                "jira": { command: "node", args: [] }
            }
        };

        await service.saveConfig(newConfig);

        assert.ok(mockFs.writeFile.calledOnce);
        const args = mockFs.writeFile.firstCall.args;
        const savedData = JSON.parse(new TextDecoder().decode(args[1]));

        assert.ok(!('mcpServers' in savedData), 'Legacy key should not be persisted');
        assert.ok(savedData.servers['pytest']); // Persisted
        assert.ok(savedData.servers['playwright']); // Persisted
        assert.ok(savedData.servers['jira']); // Added
    });

    test('mixed-key config round-trip writes only servers key', async () => {
        const mockFolder = { uri: vscode.Uri.file('/workspace'), index: 0, name: 'ws' };
        mockFs.createDirectory = sinon.stub().resolves();
        mockFs.writeFile = sinon.stub().resolves();

        const mixedConfig = {
            mcpServers: {
                jira: { command: 'legacy-node' },
                legacyOnly: { command: 'legacy-only-node' }
            },
            servers: {
                jira: { type: 'stdio', command: 'canonical-node' },
                serversOnly: { type: 'stdio', command: 'servers-only-node' }
            }
        };
        mockFs.readFile.resolves(new TextEncoder().encode(JSON.stringify(mixedConfig)));

        const service = new McpConfigService(mockContext, mockFs, [mockFolder]);
        const loaded = await service.loadConfig();
        await service.saveConfig(loaded!);

        const args = mockFs.writeFile.firstCall.args;
        const savedData = JSON.parse(new TextDecoder().decode(args[1]));
        assert.ok(!('mcpServers' in savedData), 'Legacy key must be removed on save');
        assert.ok(savedData.servers);
        assert.strictEqual(savedData.servers.jira.command, 'canonical-node');
        assert.ok(savedData.servers.legacyOnly);
        assert.ok(savedData.servers.serversOnly);
    });
});
