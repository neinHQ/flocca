import * as vscode from 'vscode';
import { PostHog } from 'posthog-node';

/**
 * TelemetryService handles anonymous usage tracking and error reporting.
 * It integrates with PostHog to provide insights into how MCP servers and tools are used.
 */
export class TelemetryService {
    private client: PostHog | undefined;
    private _outputChannel: vscode.OutputChannel;
    private _userId: string;
    private _isEnabled: boolean = true;

    constructor(private context: vscode.ExtensionContext) {
        // Create an output channel for local debugging of telemetry events
        this._outputChannel = vscode.window.createOutputChannel("Flocca Telemetry");
        
        // Use a persistent anonymous ID for tracking, default to 'unknown' if not set
        this._userId = this.context.globalState.get<string>('flocca.userId') || 'unknown';

        // Initialize PostHog client with the project API key
        try {
            this.client = new PostHog(
                'phc_ANAs8sNMa2QalfDFYi0iDMlXzFWxXqiHj9ehHLHACj1', 
                { host: 'https://us.posthog.com' }
            );
        } catch (e) {
            console.error('Failed to init PostHog', e);
        }

        // Initialize state and listen for user preference changes in VS Code settings
        this.updateConfig();
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('flocca.telemetryEnabled')) {
                this.updateConfig();
            }
        });
    }

    /**
     * Updates the local enabled state based on VS Code configuration.
     * Respects the 'flocca.telemetryEnabled' setting.
     */
    private updateConfig() {
        const config = vscode.workspace.getConfiguration('flocca');
        this._isEnabled = config.get<boolean>('telemetryEnabled', true);
        if (!this._isEnabled && this.client) {
            this.client.shutdown();
        }
    }

    /**
     * Logs a general usage event (e.g., tool call, server connection).
     * @param eventName The category of the event (e.g., 'mcp_tool_call')
     * @param properties Key-value pairs providing context (e.g., { server: 'jira', tool: 'search' })
     */
    public logUsage(eventName: string, properties: Record<string, any> = {}) {
        if (!this._isEnabled) return;

        const timestamp = new Date().toISOString();
        const data = {
            type: 'Usage',
            event: eventName,
            user: this._userId,
            timestamp,
            ...properties
        };

        // Log to local output channel for visibility
        this._outputChannel.appendLine(JSON.stringify(data));

        // Capture event in PostHog for centralized analytics
        this.client?.capture({
            distinctId: this._userId,
            event: eventName,
            properties: {
                ...properties,
                extensionVersion: vscode.extensions.getExtension('flocca.flocca')?.packageJSON.version
            }
        });
    }

    /**
     * Reports an error event with context and stack trace.
     * @param error The error object or message
     * @param context Where the error occurred (e.g., 'callTool:zephyr')
     */
    public logError(error: Error | string, context: string) {
        if (!this._isEnabled) return;

        const timestamp = new Date().toISOString();
        const message = error instanceof Error ? error.message : error;
        const stack = error instanceof Error ? error.stack : undefined;

        const data = {
            type: 'Error',
            context,
            message,
            stack: stack ? stack.split('\n')[0] : undefined,
            user: this._userId,
            timestamp
        };

        // Log to local output channel
        this._outputChannel.appendLine(JSON.stringify(data));

        // Capture error details in PostHog for proactive monitoring
        this.client?.capture({
            distinctId: this._userId,
            event: 'Error',
            properties: {
                context,
                message,
                stack, // Sent as full stack; PostHog handles multiline strings
                extensionVersion: vscode.extensions.getExtension('flocca.flocca')?.packageJSON.version
            }
        });
    }

    /**
     * Cleanup resources and ensure all pending events are flushed to PostHog.
     */
    public dispose() {
        this.client?.shutdown();
    }
}
