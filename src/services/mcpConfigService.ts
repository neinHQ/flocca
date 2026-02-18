import * as vscode from 'vscode';

export interface McpServerConfig {
    command?: string;
    url?: string;
    args?: string[];
    env?: Record<string, string>;
}

export interface McpConfig {
    mcpServers: Record<string, McpServerConfig>;
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

        // Normalize config shape (some legacy/malformed files may not have mcpServers).
        if (!config || !config.mcpServers || typeof config.mcpServers !== 'object') {
            config = { mcpServers: {} };
        }

        // Default: Add Local Codebase (Essential for Flocca)
        if (!config.mcpServers['codebase']) {
            config.mcpServers['codebase'] = {
                command: "node",
                args: [this.context.asAbsolutePath("resources/servers/codebase/server.js")]
            };
        }

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

            // Write File
            const data = new TextEncoder().encode(JSON.stringify(config, null, 2));
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
