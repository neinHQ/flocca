import * as vscode from 'vscode';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SubscriptionService } from './subscriptionService';

import { TelemetryService } from './telemetryService';

export type ListToolsResultSchema = any; // Schema.ListToolsResult
export type CallToolResultSchema = any; // Schema.CallToolResult

export class McpClientManager {
    private _clients: Map<string, Client> = new Map();
    private _transports: Map<string, StdioClientTransport | SSEClientTransport> = new Map();

    constructor(private context: vscode.ExtensionContext, private subscriptionService: SubscriptionService, private telemetryService: TelemetryService) { }

    async connectLocal(name: string, command: string, args: string[], env: Record<string, string> = {}) {
        const envVars = { ...process.env, ...env } as Record<string, string>;
        const transport = new StdioClientTransport({
            command,
            args,
            env: envVars
        });

        const client = new Client({
            name: "FloccaClient",
            version: "1.0.0",
        }, {
            capabilities: {}
        });

        await client.connect(transport);
        this._clients.set(name, client);
        this._transports.set(name, transport);
        console.log(`Connected to local MCP server: ${name}`);
        // vscode.window.showInformationMessage(`Connected to local MCP server: ${name}`);
    }

    async connectRemote(name: string, url: string, headers: Record<string, string> = {}) {
        // Type assertion to bypass strict Check in DOM lib which might be missing headers in EventSourceInit
        const eventSourceInit = {
            withCredentials: true,
            headers: headers
        } as any;

        const transport = new SSEClientTransport(new URL(url), eventSourceInit);

        const client = new Client({
            name: "FloccaClient",
            version: "1.0.0",
        }, {
            capabilities: {}
        });

        await client.connect(transport);
        this._clients.set(name, client);
        this._transports.set(name, transport);
        console.log(`Connected to remote MCP server: ${name}`);
        vscode.window.showInformationMessage(`Connected to remote MCP server: ${name}`);
    }

    async disconnect(name: string) {
        const client = this._clients.get(name);
        if (client) {
            try {
                await client.close();
            } catch (e) {
                console.error(`Error closing client ${name}:`, e);
            }
            this._clients.delete(name);
        }

        const transport = this._transports.get(name);
        if (transport) {
            try {
                await transport.close();
            } catch (e) {
                console.error(`Error closing transport ${name}:`, e);
            }
        }
        this._transports.delete(name);
        console.log(`Disconnected MCP server: ${name}`);
    }

    getClient(name: string): Client | undefined {
        return this._clients.get(name);
    }

    getConnectedClients(): string[] {
        return Array.from(this._clients.keys());
    }

    async listTools(): Promise<ListToolsResultSchema[]> {
        const results: ListToolsResultSchema[] = [];
        for (const [name, client] of this._clients) {
            try {
                // @ts-ignore
                const tools = await client.listTools();
                results.push(tools);
            } catch (e) { console.error(e); }
        }
        return results;
    }

    async callTool(serverName: string, toolName: string, args: any): Promise<CallToolResultSchema> {
        // ENFORCE SUBSCRIPTION
        // We allow 'listTools' (implied) but block 'callTool' if not subbed
        // Exception: Maybe 'listTools' is safe.
        if (!this.subscriptionService.checkAccess(`mcp_tool:${serverName}`)) {
            this.telemetryService.logUsage('mcp_tool_blocked', { server: serverName, tool: toolName });
            throw new Error("SUBSCRIPTION_REQUIRED");
        }

        const client = this._clients.get(serverName);
        if (!client) {
            this.telemetryService.logError(`Server ${serverName} not found`, 'callTool');
            throw new Error(`Server ${serverName} not found or not connected.`);
        }

        try {
            this.telemetryService.logUsage('mcp_tool_call', { server: serverName, tool: toolName });
            // @ts-ignore
            const result = await client.callTool({
                name: toolName,
                arguments: args
            });
            return result as CallToolResultSchema;
        } catch (error: any) {
            this.telemetryService.logError(error, `callTool:${serverName}:${toolName}`);
            throw error;
        }
    }
}
