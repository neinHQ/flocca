import * as vscode from 'vscode';
import { PostHog } from 'posthog-node';

export class TelemetryService {
    private client: PostHog | undefined;
    private _outputChannel: vscode.OutputChannel;
    private _userId: string;
    private _isEnabled: boolean = true;

    constructor(private context: vscode.ExtensionContext) {
        this._outputChannel = vscode.window.createOutputChannel("Flocca Telemetry");
        this._userId = this.context.globalState.get<string>('flocca.userId') || 'unknown';

        // Initialize PostHog
        try {
            this.client = new PostHog(
                'phx_a52PtRJsnj7kVBDvuHLQmJgyConPDo4rdNlKaNR355vyXNO', // User provided key
                { host: 'https://us.i.posthog.com' } // Default US host, user can change if needed
            );
        } catch (e) {
            console.error('Failed to init PostHog', e);
        }

        // Initial check and listen for config changes
        this.updateConfig();
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('flocca.telemetryEnabled')) {
                this.updateConfig();
            }
        });
    }

    private updateConfig() {
        const config = vscode.workspace.getConfiguration('flocca');
        this._isEnabled = config.get<boolean>('telemetryEnabled', true);
        if (!this._isEnabled && this.client) {
            this.client.shutdown();
        }
    }

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

        this._outputChannel.appendLine(JSON.stringify(data));

        // Send to PostHog
        this.client?.capture({
            distinctId: this._userId,
            event: eventName,
            properties: {
                ...properties,
                extensionVersion: vscode.extensions.getExtension('flocca.flocca')?.packageJSON.version
            }
        });
    }

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

        this._outputChannel.appendLine(JSON.stringify(data));

        // Send to PostHog
        this.client?.capture({
            distinctId: this._userId,
            event: 'Error',
            properties: {
                context,
                message,
                stack, // PostHog handles large strings well
                extensionVersion: vscode.extensions.getExtension('flocca.flocca')?.packageJSON.version
            }
        });
    }

    public dispose() {
        this.client?.shutdown();
    }
}
