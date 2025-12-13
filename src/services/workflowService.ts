import * as vscode from 'vscode';
import { McpClientManager } from './mcpClientService';
import { TextDecoder } from 'util';

import { TelemetryService } from './telemetryService';

export interface WorkflowStep {
    id: string;
    serverName: string;
    toolName: string;
    arguments: any;
}

export interface Workflow {
    name: string;
    description?: string;
    steps: WorkflowStep[];
}

export class WorkflowService {
    constructor(private context: vscode.ExtensionContext, private clientManager: McpClientManager, private telemetryService: TelemetryService) { }

    async getWorkflows(): Promise<Workflow[]> {
        const workflows: Workflow[] = [];
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) return [];

        const workflowsDir = vscode.Uri.joinPath(workspaceFolders[0].uri, '.vscode', 'flocca', 'workflows');

        try {
            const files = await vscode.workspace.fs.readDirectory(workflowsDir);
            for (const [name, type] of files) {
                if (type === vscode.FileType.File && name.endsWith('.json')) {
                    const fileUri = vscode.Uri.joinPath(workflowsDir, name);
                    const content = await vscode.workspace.fs.readFile(fileUri);
                    const json = JSON.parse(new TextDecoder().decode(content));
                    // Basic validation
                    if (json.name && Array.isArray(json.steps)) {
                        workflows.push(json as Workflow);
                    }
                }
            }
        } catch (e) {
            // Directory might not exist or empty
        }
        return workflows;
    }

    async saveWorkflow(workflow: Workflow) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) throw new Error("No workspace open");

        const workflowsDir = vscode.Uri.joinPath(workspaceFolders[0].uri, '.vscode', 'flocca', 'workflows');
        // Ensure dir exists
        try { await vscode.workspace.fs.createDirectory(workflowsDir); } catch { }

        const fileUri = vscode.Uri.joinPath(workflowsDir, `${workflow.name.replace(/\s+/g, '_').toLowerCase()}.json`);
        const content = new TextEncoder().encode(JSON.stringify(workflow, null, 2));
        await vscode.workspace.fs.writeFile(fileUri, content);
    }

    async executeWorkflow(workflow: Workflow, logFn: (msg: string) => void) {
        logFn(`Starting Workflow: ${workflow.name}`);
        this.telemetryService.logUsage('workflow_execution', { workflowName: workflow.name, stepCount: workflow.steps.length });

        const context: Record<string, any> = {};

        for (const step of workflow.steps) {
            logFn(`Step ${step.id}: Running ${step.toolName} on ${step.serverName}...`);

            // 1. Resolve Variables
            let args = step.arguments;
            try {
                args = this.resolveVariables(step.arguments, context);
            } catch (e: any) {
                logFn(`Error resolving variables for step ${step.id}: ${e.message}`);
                throw e;
            }

            // 2. Execute
            try {
                const result: any = await this.clientManager.callTool(step.serverName, step.toolName, args);

                // 3. Store Result
                // Normalize result: if it's a string, wrap it. If object, store as is.
                // standard MCP result is { content: [{ type: 'text', text: '...' }] }
                // We'll store the raw result, but also maybe flat text for ease.
                context[step.id] = {
                    result: result,
                    // Helper for direct text access if common structure
                    text: result?.content?.[0]?.text || JSON.stringify(result)
                };

                const output = result?.content?.[0]?.text || JSON.stringify(result);
                logFn(`Result: ${output.substring(0, 150)}${output.length > 150 ? '...' : ''}`);
            } catch (e) {
                logFn(`Error in step ${step.id}: ${e}`);
                throw e; // Stop execution on error
            }
        }
        logFn(`Workflow ${workflow.name} Completed.`);
    }

    private resolveVariables(input: any, context: Record<string, any>): any {
        if (typeof input === 'string') {
            // Match ${stepId.result.field} or ${stepId.text}
            // Simple regex for ${...}
            return input.replace(/\$\{([^}]+)\}/g, (_, path) => {
                const value = this.getValueFromPath(path, context);
                return value !== undefined ? String(value) : '';
            });
        } else if (Array.isArray(input)) {
            return input.map(item => this.resolveVariables(item, context));
        } else if (typeof input === 'object' && input !== null) {
            const output: any = {};
            for (const key in input) {
                output[key] = this.resolveVariables(input[key], context);
            }
            return output;
        }
        return input;
    }

    private getValueFromPath(path: string, context: any): any {
        // path e.g. "step1.result.key"
        const parts = path.split('.');
        let current = context;
        for (const part of parts) {
            if (current === undefined || current === null) return undefined;
            current = current[part];
        }
        return current;
    }
}
