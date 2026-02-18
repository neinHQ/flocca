import * as vscode from 'vscode';

export interface McpServerConfig {
    type?: 'stdio' | 'sse';
    command?: string;
    url?: string;
    args?: string[];
    env?: Record<string, string>;
}

export interface McpConfig {
    mcpServers: Record<string, McpServerConfig>;
    servers?: Record<string, McpServerConfig>;
}

export class McpConfigService {
    constructor(private context: vscode.ExtensionContext, private fs: vscode.FileSystem = vscode.workspace.fs, private workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined = vscode.workspace.workspaceFolders) { }

    async loadConfig(): Promise<McpConfig | undefined> {
        let config: McpConfig | undefined;
        // Use injected folders
        const folders = this.workspaceFolders;

        if (folders) {
            const rootPath = folders[0].uri;
            const configUri = vscode.Uri.joinPath(rootPath, '.vscode', 'mcp.json');
            try {
                const fileData = await this.fs.readFile(configUri);
                const configString = new TextDecoder().decode(fileData);
                config = JSON.parse(configString) as McpConfig;
            } catch (error) {
                // Ignore file not found
            }
        }

        const raw = config as any;
        let serverMap: Record<string, McpServerConfig> = {};
        if (raw?.mcpServers && typeof raw.mcpServers === 'object') {
            serverMap = raw.mcpServers;
        } else if (raw?.servers && typeof raw.servers === 'object') {
            serverMap = raw.servers;
        }
        config = { mcpServers: serverMap, servers: { ...serverMap } };

        // Default: Add Local Codebase (Essential for Flocca)
        if (!config.mcpServers['codebase']) {
            config.mcpServers['codebase'] = {
                type: 'stdio',
                command: "node",
                args: [this.context.asAbsolutePath("resources/servers/codebase/server.js")]
            };
        }
        config.servers = { ...config.mcpServers };

        // Validation
        if (!config.mcpServers) {
            return undefined;
        }

        return config;
    }

    async saveConfig(config: McpConfig): Promise<void> {
        if (!this.workspaceFolders) return;

        const rootPath = this.workspaceFolders[0].uri;
        const vscodeDir = vscode.Uri.joinPath(rootPath, '.vscode');
        const configUri = vscode.Uri.joinPath(vscodeDir, 'mcp.json');

        try {
            // Ensure .vscode exists
            await this.fs.createDirectory(vscodeDir);

            const normalizedServers: Record<string, McpServerConfig> = {};
            for (const [name, server] of Object.entries(config.mcpServers || {})) {
                const inferredType: 'stdio' | 'sse' | undefined = server.type || (server.url ? 'sse' : (server.command ? 'stdio' : undefined));
                normalizedServers[name] = {
                    ...server,
                    ...(inferredType ? { type: inferredType } : {})
                };
            }

            const fileShape = {
                ...config,
                mcpServers: normalizedServers,
                // VS Code/Copilot-compatible MCP config key.
                servers: normalizedServers
            };

            // Write File
            const data = new TextEncoder().encode(JSON.stringify(fileShape, null, 2));
            await this.fs.writeFile(configUri, data);
        } catch (e) {
            console.error('Failed to save mcp.json:', e);
            vscode.window.showErrorMessage(`Failed to save MCP config: ${e}`);
        }
    }

    async deleteConfig(): Promise<void> {
        if (!this.workspaceFolders) return;
        const configUri = vscode.Uri.joinPath(this.workspaceFolders[0].uri, '.vscode', 'mcp.json');

        try {
            await this.fs.delete(configUri, { recursive: false, useTrash: false });
        } catch (e) {
            // Ignore if file doesn't exist
        }
    }
}
