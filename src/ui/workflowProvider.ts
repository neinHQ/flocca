import * as vscode from 'vscode';
import { WorkflowService, Workflow, WorkflowStep } from '../services/workflowService';
import { McpClientManager } from '../services/mcpClientService';

export class WorkflowProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'flocca-workflows';
    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _workflowService: WorkflowService,
        private readonly _clientManager: McpClientManager
    ) { }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'save':
                    await this._workflowService.saveWorkflow(data.workflow);
                    vscode.window.showInformationMessage(`Workflow saved: ${data.workflow.name}`);
                    this.refreshWorkflows();
                    break;
                case 'run':
                    vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: `Running ${data.workflow.name}`,
                        cancellable: false
                    }, async (progress) => {
                        try {
                            await this._workflowService.executeWorkflow(data.workflow, (msg) => {
                                // Send log to UI
                                if (this._view) {
                                    this._view.webview.postMessage({ type: 'log', message: msg });
                                }
                            });
                            vscode.window.showInformationMessage(`Workflow ${data.workflow.name} Completed Successfully.`);
                        } catch (e: any) {
                            vscode.window.showErrorMessage(`Workflow Failed: ${e.message}`);
                            if (this._view) {
                                this._view.webview.postMessage({ type: 'log', message: `ERROR: ${e.message}` });
                            }
                        }
                    });
                    break;
                case 'refresh':
                    this.refreshWorkflows();
                    break;
                case 'getTools':
                    // Fetch tools dynamically
                    const tools = await this._clientManager.listTools();
                    if (this._view) {
                        this._view.webview.postMessage({ type: 'setTools', tools });
                    }
                    break;
            }
        });

        // Initial load
        this.refreshWorkflows();
    }

    private async refreshWorkflows() {
        if (this._view) {
            const workflows = await this._workflowService.getWorkflows();
            this._view.webview.postMessage({ type: 'updateList', workflows });
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Flocca Workflows</title>
             <style>
                /* Button Color System */
                :root {
                    --btn-connect: #6c5ce7;      /* Purple */
                    --btn-connecting: #2d3436;   /* Dark */
                    --btn-connected: #00b894;    /* Teal */
                    --btn-text: #ffffff;
                }

                body { font-family: var(--vscode-font-family); padding: 10px; color: var(--vscode-foreground); }
                .workflow-list { margin-bottom: 20px; }
                .workflow-item { padding: 8px; margin-bottom: 5px; background: var(--vscode-list-hoverBackground); cursor: pointer; display: flex; justify-content: space-between; align-items: center; border-radius: 4px; }
                
                button { 
                    background: var(--btn-connect); 
                    color: var(--btn-text);
                    border: none; padding: 6px 12px; cursor: pointer; border-radius: 4px; 
                    font-weight: 500; font-size: 12px;
                    transition: opacity 0.2s;
                }
                button:hover { opacity: 0.9; }

                /* Variants */
                button.secondary, button.remove {
                    background: var(--btn-connecting);
                }
                
                input, select, textarea { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 5px; margin-bottom: 5px; display: block; width: 100%; box-sizing: border-box; }
                #editor { border-top: 1px solid var(--vscode-widget-border); padding-top: 10px; display: none; margin-top: 20px; }
                .step { border: 1px solid var(--vscode-widget-border); padding: 10px; margin-bottom: 10px; border-radius: 4px; background: var(--vscode-editor-background); }
                .step-header { display: flex; justify-content: space-between; margin-bottom: 5px; font-weight: bold; }
                .console { background: #000; color: #0f0; padding: 10px; font-family: monospace; height: 150px; overflow-y: auto; margin-top: 10px; border-radius: 4px; display: none; }
                .row { display: flex; gap: 10px; }
                .col { flex: 1; }
            </style>
        </head>
        <body>
            <h3>Saved Workflows</h3>
            <div id="list" class="workflow-list"></div>
            <button onclick="newWorkflow()">+ New Workflow</button>
            <button class="secondary" onclick="refresh()">Refresh</button>

            <div id="editor">
                <h4>Edit Workflow</h4>
                <input type="text" id="wfName" placeholder="Workflow Name" />
                
                <div id="steps"></div>
                
                <button onclick="addStep()">+ Add Step</button>
                <div style="margin-top: 10px; text-align: right;">
                    <button onclick="saveWorkflow()">Save Workflow</button>
                    <button onclick="runWorkflow()">Run Workflow</button>
                </div>

                <div id="console" class="console"></div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                let currentWorkflow = null;
                let availableTools = []; // [{ server: 's1', tools: [...] }]

                // Listen for messages
                window.addEventListener('message', event => {
                    const message = event.data;
                    switch (message.type) {
                        case 'updateList':
                            renderList(message.workflows);
                            break;
                        case 'setTools':
                            availableTools = message.tools;
                            // Re-render editor if open to populate dropdowns?
                            if(currentWorkflow) renderEditor(); 
                            break;
                        case 'log':
                            logToConsole(message.message);
                            break;
                    }
                });

                function refresh() {
                    vscode.postMessage({ type: 'refresh' });
                    vscode.postMessage({ type: 'getTools' }); // Fetch tools on refresh too
                }
                
                // Initial fetch
                vscode.postMessage({ type: 'getTools' });

                function renderList(workflows) {
                    const div = document.getElementById('list');
                    div.innerHTML = '';
                    workflows.forEach(wf => {
                        const el = document.createElement('div');
                        el.className = 'workflow-item';
                        // Escaped backticks for inner template
                        el.innerHTML = \`<span>\${wf.name} (\${wf.steps.length} steps)</span> <button onclick='loadWorkflow(\${JSON.stringify(wf)})'>Edit</button>\`;
                        div.appendChild(el);
                    });
                }

                function newWorkflow() {
                    currentWorkflow = { name: "New Workflow", steps: [] };
                    renderEditor();
                }

                function loadWorkflow(wf) {
                    currentWorkflow = wf;
                    renderEditor();
                }

                function renderEditor() {
                    document.getElementById('editor').style.display = 'block';
                    document.getElementById('wfName').value = currentWorkflow.name;
                    document.getElementById('console').style.display = 'none';
                    document.getElementById('console').innerHTML = ''; // Clear logs

                    const stepsDiv = document.getElementById('steps');
                    stepsDiv.innerHTML = '';
                    
                    currentWorkflow.steps.forEach((step, index) => {
                        const s = document.createElement('div');
                        s.className = 'step';
                        
                        // Server Options
                        let serverOptions = '<option value="">Select Server</option>';
                        availableTools.forEach(t => {
                            serverOptions += \`<option value="\${t.server}" \${t.server === step.serverName ? 'selected' : ''}>\${t.server}</option>\`;
                        });

                        // Tool Options (dependent on selected server if possible, for now flatten list or show all for selected server)
                        let toolOptions = '<option value="">Select Tool</option>';
                        const selectedServerTools = availableTools.find(t => t.server === step.serverName)?.tools || [];
                        selectedServerTools.forEach(tool => {
                            toolOptions += \`<option value="\${tool.name}" \${tool.name === step.toolName ? 'selected' : ''}>\${tool.name}</option>\`;
                        });

                        s.innerHTML = \`
                            <div class="step-header">
                                <span>Step \${index + 1} (ID: \${step.id})</span>
                                <button class="remove" onclick="removeStep(\${index})" style="padding: 2px 6px; font-size: 10px;">Remove</button>
                            </div>
                            <div class="row">
                                <div class="col">
                                    <label>Server</label>
                                    <select onchange="updateStep(\${index}, 'serverName', this.value); renderEditor();">\${serverOptions}</select>
                                </div>
                                <div class="col">
                                    <label>Tool</label>
                                    <select onchange="updateStep(\${index}, 'toolName', this.value)">\${toolOptions}</select>
                                </div>
                            </div>
                            <div>
                                <label>Arguments (JSON)</label>
                                <textarea onchange="updateStep(\${index}, 'arguments', this.value)" rows="3">\${JSON.stringify(step.arguments, null, 2)}</textarea>
                            </div>
                        \`;
                        stepsDiv.appendChild(s);
                    });
                }

                function addStep() {
                    currentWorkflow.steps.push({ id: 'step_' + Date.now(), serverName: "", toolName: "", arguments: {} });
                    renderEditor();
                }

                function removeStep(index) {
                    currentWorkflow.steps.splice(index, 1);
                    renderEditor();
                }

                function updateStep(index, field, value) {
                    if (field === 'arguments') {
                        try {
                            currentWorkflow.steps[index].arguments = JSON.parse(value);
                        } catch(e) {}
                    } else {
                        currentWorkflow.steps[index][field] = value;
                    }
                }

                function saveWorkflow() {
                    currentWorkflow.name = document.getElementById('wfName').value;
                    vscode.postMessage({ type: 'save', workflow: currentWorkflow });
                }
                
                function runWorkflow() {
                     currentWorkflow.name = document.getElementById('wfName').value;
                     document.getElementById('console').style.display = 'block';
                     document.getElementById('console').innerHTML = 'Starting...<br>';
                     vscode.postMessage({ type: 'run', workflow: currentWorkflow });
                }

                function logToConsole(msg) {
                    const consoleDiv = document.getElementById('console');
                    consoleDiv.innerHTML += \`<div>\${msg}</div>\`;
                    consoleDiv.scrollTop = consoleDiv.scrollHeight;
                }

            </script>
        </body>
        </html>`;
    }
}
