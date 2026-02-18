import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { McpConfigService } from '../../services/mcpConfigService';
import { TextEncoder } from 'util';

suite('Config Sync Security Test Suite', () => {
    let mockContext: vscode.ExtensionContext;
    let mockFs: any;
    let workspaceFolders: vscode.WorkspaceFolder[];

    setup(() => {
        mockContext = {
            asAbsolutePath: (p: string) => `/abs/${p}`
        } as unknown as vscode.ExtensionContext;

        mockFs = {
            createDirectory: sinon.stub().resolves(),
            writeFile: sinon.stub().resolves(),
            delete: sinon.stub().resolves(),
            readFile: sinon.stub().resolves(new TextEncoder().encode('{}'))
        };

        workspaceFolders = [
            { uri: vscode.Uri.file('/workspace'), index: 0, name: 'ws' }
        ];
    });

    test('saveConfig should create .vscode directory and write mcp.json', async () => {
        const service = new McpConfigService(mockContext, mockFs, workspaceFolders);
        const config = { servers: { github: { command: 'npx' } } };

        await service.saveConfig(config);

        // Verify Directory Creation
        assert.strictEqual(mockFs.createDirectory.calledOnce, true);
        const dirArgs = mockFs.createDirectory.firstCall.args[0];
        assert.ok(dirArgs.path.endsWith('.vscode'), 'Should create .vscode dir');

        // Verify File Write
        assert.strictEqual(mockFs.writeFile.calledOnce, true);
        const fileArgs = mockFs.writeFile.firstCall.args;
        assert.ok(fileArgs[0].path.endsWith('mcp.json'), 'Should write to mcp.json');

        const writtenContent = JSON.parse(new TextDecoder().decode(fileArgs[1]));
        assert.ok(!('mcpServers' in writtenContent), 'Should not write legacy mcpServers key');
        assert.ok(writtenContent.servers, 'Should write VS Code-compatible servers key');
        assert.ok(writtenContent.servers.github, 'Should preserve provided server entries');
    });

    test('deleteConfig should delete mcp.json', async () => {
        const service = new McpConfigService(mockContext, mockFs, workspaceFolders);

        await service.deleteConfig();

        assert.strictEqual(mockFs.delete.calledOnce, true);
        const delArgs = mockFs.delete.firstCall.args;
        assert.ok(delArgs[0].path.endsWith('mcp.json'));
        assert.strictEqual(delArgs[1].useTrash, false, 'Should skip trash for security');
    });

    test('saveConfig/deleteConfig should gracefully handle no workspace', async () => {
        const service = new McpConfigService(mockContext, mockFs, undefined);

        // Should not throw
        await service.saveConfig({ servers: {} });
        await service.deleteConfig();

        assert.strictEqual(mockFs.createDirectory.called, false);
        assert.strictEqual(mockFs.writeFile.called, false);
        assert.strictEqual(mockFs.delete.called, false);
    });
});
