import * as vscode from 'vscode';

interface FieldConfig {
    id: string;
    label: string;
    type?: string;
    placeholder?: string;
    value?: string;
    required?: boolean;
}

interface ProviderConfig {
    title: string;
    fields: FieldConfig[];
    links?: { text: string; url: string }[];
}

const PROVIDER_CONFIG: { [key: string]: ProviderConfig } = {
    'jira': {
        title: 'Connect Jira',
        fields: [
            { id: 'url', label: 'Jira Base URL', placeholder: 'https://your-domain.atlassian.net or https://jira.your-company.com', type: 'text' },
            { id: 'deployment_mode', label: 'Deployment Mode (cloud/server)', placeholder: 'cloud', type: 'text', required: false },
            { id: 'email', label: 'Email Address', placeholder: 'name@example.com', type: 'email' },
            { id: 'token', label: 'API Token', placeholder: 'Paste your API token', type: 'password' }
        ],
        links: [{ text: 'Get Jira API Token', url: 'https://id.atlassian.com/manage-profile/security/api-tokens' }]
    },
    'confluence': {
        title: 'Connect Confluence',
        fields: [
            { id: 'url', label: 'Confluence Base URL', placeholder: 'https://your-domain.atlassian.net or https://confluence.your-company.com', type: 'text' },
            { id: 'deployment_mode', label: 'Deployment Mode (cloud/server)', placeholder: 'cloud', type: 'text', required: false },
            { id: 'email', label: 'Email Address', placeholder: 'name@example.com', type: 'email' },
            { id: 'token', label: 'API Token', placeholder: 'Paste your API token', type: 'password' }
        ],
        links: [{ text: 'Get Confluence API Token', url: 'https://id.atlassian.com/manage-profile/security/api-tokens' }]
    },
    'gitlab': {
        title: 'Connect GitLab',
        fields: [
            { id: 'url', label: 'GitLab Base URL', placeholder: 'https://gitlab.com or https://gitlab.company.com', type: 'text', value: 'https://gitlab.com' },
            { id: 'deployment_mode', label: 'Deployment Mode (cloud/self_hosted)', placeholder: 'cloud', type: 'text', required: false },
            { id: 'token', label: 'Personal Access Token', placeholder: 'glpat-...', type: 'password' }
        ],
        links: [{ text: 'Create Token', url: 'https://gitlab.com/-/profile/personal_access_tokens' }]
    },
    'bitbucket': {
        title: 'Connect Bitbucket',
        fields: [
            { id: 'url', label: 'Bitbucket URL', placeholder: 'https://bitbucket.org or https://bitbucket.your-company.com', type: 'text', required: false },
            { id: 'deployment_mode', label: 'Deployment Mode (cloud/server)', placeholder: 'cloud', type: 'text', required: false },
            { id: 'username', label: 'Username', placeholder: 'Bitbucket Username', type: 'text' },
            { id: 'password', label: 'App Password', placeholder: 'App Password', type: 'password' },
            { id: 'workspace', label: 'Workspace ID (Optional)', placeholder: 'workspace-id', type: 'text' }
        ],
        links: [{ text: 'Create App Password', url: 'https://bitbucket.org/account/settings/app-passwords/' }]
    },
    'kubernetes': {
        title: 'Connect Kubernetes',
        fields: [
            { id: 'kubeconfig', label: 'Kubeconfig Path (Optional)', placeholder: '/Users/you/.kube/config', type: 'text' },
            { id: 'api_server', label: 'API Server URL (Optional)', placeholder: 'https://127.0.0.1:6443', type: 'text' },
            { id: 'token', label: 'Bearer Token (Optional)', placeholder: 'eyJ...', type: 'password' }
        ],
        links: [{ text: 'Kubernetes Authentication', url: 'https://kubernetes.io/docs/reference/access-authn-authz/authentication/' }]
    },
    'aws': {
        title: 'Connect AWS',
        fields: [
            { id: 'region', label: 'Region', placeholder: 'us-east-1', type: 'text' },
            { id: 'access_key', label: 'Access Key ID', placeholder: 'AKIA...', type: 'text' },
            { id: 'secret_key', label: 'Secret Access Key', placeholder: 'Secret...', type: 'password' },
            { id: 'session_token', label: 'Session Token (Optional)', placeholder: 'Token...', type: 'password' }
        ],
        links: [{ text: 'Security Credentials', url: 'https://us-east-1.console.aws.amazon.com/iam/home?region=us-east-1#/security_credentials' }]
    },
    'gcp': {
        title: 'Connect GCP',
        fields: [
            { id: 'project_id', label: 'Project ID', placeholder: 'my-project-id', type: 'text' },
            { id: 'token', label: 'Access Token', placeholder: 'ya29...', type: 'password' },
            { id: 'region', label: 'Default Region (Optional)', placeholder: 'us-central1', type: 'text' }
        ],
        links: [{ text: 'Get Access Token (gcloud auth print-access-token)', url: 'https://cloud.google.com/sdk/gcloud/reference/auth/print-access-token' }]
    },
    'azure': {
        title: 'Connect Azure',
        fields: [
            { id: 'subscription_id', label: 'Subscription ID', placeholder: 'uuid', type: 'text' },
            { id: 'token', label: 'Access Token', placeholder: 'eyJ...', type: 'password' },
            { id: 'tenant_id', label: 'Tenant ID (Optional)', placeholder: 'uuid', type: 'text' }
        ],
        links: [{ text: 'Get Access Token (az account get-access-token)', url: 'https://learn.microsoft.com/en-us/cli/azure/account?view=azure-cli-latest#az-account-get-access-token' }]
    },
    'figma': {
        title: 'Connect Figma',
        fields: [
            { id: 'token', label: 'Personal Access Token', placeholder: 'figd_...', type: 'password' }
        ],
        links: [{ text: 'Get Access Token', url: 'https://www.figma.com/developers/api#access-tokens' }]
    },
    'docker': {
        title: 'Connect Docker',
        fields: [
            { id: 'host', label: 'Docker Host (Optional)', placeholder: 'unix:///var/run/docker.sock', type: 'text' }
        ],
        links: []
    },
    'postgres': {
        title: 'Connect PostgreSQL',
        fields: [
            { id: 'connection_string', label: 'Connection String', placeholder: 'postgresql://user:pass@localhost:5432/db', type: 'password' }
        ],
        links: []
    },
    'slack': {
        title: 'Connect Slack',
        fields: [
            { id: 'token', label: 'Bot User OAuth Token', placeholder: 'xoxb-...', type: 'password' }
        ],
        links: [{ text: 'Create App & Token', url: 'https://api.slack.com/apps' }]
    },
    'stripe': {
        title: 'Connect Stripe',
        fields: [
            { id: 'key', label: 'Secret Key', placeholder: 'sk_test_...', type: 'password' }
        ]
    },
    'zephyr': {
        title: 'Connect Zephyr Scale',
        fields: [
            { id: 'url', label: 'Jira Site URL', placeholder: 'https://your-domain.atlassian.net', type: 'text' },
            { id: 'token', label: 'Bearer Token', placeholder: 'Bearer Token', type: 'password' },
            { id: 'projectKey', label: 'Jira Project Key', placeholder: 'PROJ', type: 'text' }
        ],
        links: [{ text: 'Get Token', url: 'https://support.smartbear.com/zephyr-scale-cloud/docs/rest-api/generating-api-access-tokens.html' }]
    },
    'zephyr-enterprise': {
        title: 'Connect Zephyr Ent.',
        fields: [
            { id: 'url', label: 'Base URL', placeholder: 'https://zephyr.your-company.com', type: 'text' },
            { id: 'username', label: 'Username', placeholder: 'user.name', type: 'text' },
            { id: 'token', label: 'API Token', placeholder: 'Token', type: 'password' },
            { id: 'project_id', label: 'Project ID (Optional)', placeholder: '123', type: 'text' }
        ],
        links: [{ text: 'Zephyr Enterprise API Docs', url: 'https://support.smartbear.com/zephyr-enterprise-server/docs/api/index.html' }]
    },
    'elastic': {
        title: 'Connect Elasticsearch',
        fields: [
            { id: 'url', label: 'Cluster URL', placeholder: 'https://my-es-cluster:9200', type: 'text' },
            { id: 'api_key', label: 'API Key (Optional)', placeholder: 'Base64 Encoded Key', type: 'password' },
            { id: 'username', label: 'Username (Optional)', placeholder: 'elastic', type: 'text' },
            { id: 'password', label: 'Password (Optional)', placeholder: 'changeme', type: 'password' },
            { id: 'indices', label: 'Default Indices (comma sep)', placeholder: 'logs-*,metrics-*', type: 'text' }
        ],
        links: []
    },
    'observability': {
        title: 'Connect Observability',
        fields: [
            { id: 'prometheus_url', label: 'Prometheus URL', placeholder: 'http://prometheus:9090', type: 'text' },
            { id: 'grafana_url', label: 'Grafana URL', placeholder: 'http://grafana:3000', type: 'text' },
            { id: 'grafana_token', label: 'Grafana Token (Optional)', placeholder: 'ey...', type: 'password' }
        ],
        links: []
    },
    'sentry': {
        title: 'Connect Sentry',
        fields: [
            { id: 'token', label: 'Auth Token', placeholder: 'sntry_...', type: 'password' },
            { id: 'org_slug', label: 'Organization Slug', placeholder: 'my-org', type: 'text' },
            { id: 'base_url', label: 'Base URL (Optional)', placeholder: 'https://sentry.io/api/0', type: 'text' }
        ],
        links: [{ text: 'Create Auth Token', url: 'https://sentry.io/settings/account/api/auth-tokens/' }]
    },
    'notion': {
        title: 'Connect Notion',
        fields: [
            { id: 'token', label: 'Integration Token', placeholder: 'secret_...', type: 'password' }
        ],
        links: [{ text: 'My Integrations', url: 'https://www.notion.so/my-integrations' }]
    },
    'teams': {
        title: 'Connect Teams',
        fields: [
            { id: 'token', label: 'Graph API Token', placeholder: 'Access Token', type: 'password' },
            { id: 'tenant_id', label: 'Tenant ID (Optional)', placeholder: 'uuid', type: 'text' }
        ],
        links: [{ text: 'Graph Explorer', url: 'https://developer.microsoft.com/en-us/graph/graph-explorer' }]
    },
    'azuredevops': {
        title: 'Connect Azure DevOps',
        fields: [
            { id: 'org_url', label: 'Organization URL', placeholder: 'https://dev.azure.com/my-org', type: 'text' },
            { id: 'project', label: 'Project', placeholder: 'my-project', type: 'text' },
            { id: 'token', label: 'Personal Access Token', placeholder: 'PAT...', type: 'password' }
        ],
        links: [{ text: 'Create PAT', url: 'https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate?view=azure-devops&tabs=Windows' }]
    },
    'testrail': {
        title: 'Connect TestRail',
        fields: [
            { id: 'url', label: 'Instance URL', placeholder: 'https://my.testrail.io', type: 'text' },
            { id: 'username', label: 'Username', placeholder: 'user@example.com', type: 'text' },
            { id: 'api_key', label: 'API Key', placeholder: 'Key...', type: 'password' },
            { id: 'project_id', label: 'Project ID', placeholder: '1', type: 'text' },
            { id: 'suite_id', label: 'Suite ID (Optional)', placeholder: '2', type: 'text', required: false }
        ],
        links: [{ text: 'My Settings (API Keys)', url: 'https://secure.testrail.com/customers/testrail/settings/api' }]
    },
    'cypress': {
        title: 'Connect Cypress',
        fields: [
            { id: 'project_root', label: 'Project Root', placeholder: '/path/to/project', type: 'text' }
        ],
        links: []
    },
    'github_actions': {
        title: 'Connect GitHub Actions',
        fields: [
            { id: 'api_url', label: 'API URL (Optional, GHES)', placeholder: 'https://github.company.com/api/v3', type: 'text', required: false },
            { id: 'owner', label: 'Repo Owner', placeholder: 'microsoft', type: 'text' },
            { id: 'repo', label: 'Repo Name', placeholder: 'vscode', type: 'text' },
            { id: 'token', label: 'GitHub Token', placeholder: 'ghp_...', type: 'password' }
        ],
        links: []
    },
    'pytest': {
        title: 'Connect Pytest',
        fields: [
            { id: 'args', label: 'Additional Arguments (Optional)', placeholder: '--verbose', type: 'text', required: false }
        ],
        links: []
    },
    'playwright': {
        title: 'Connect Playwright',
        fields: [
            { id: 'args', label: 'Additional Arguments (Optional)', placeholder: '--headed', type: 'text', required: false }
        ],
        links: []
    }
};

export class ConnectWebview {
    public static currentPanel: ConnectWebview | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    public readonly provider: string;
    private readonly _onConnect: (data: any) => Promise<void>;

    public static show(context: vscode.ExtensionContext, provider: string, onConnect: (data: any) => Promise<void>) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, check if we need to switch providers
        if (ConnectWebview.currentPanel) {
            if (ConnectWebview.currentPanel.provider !== provider) {
                // Different provider? Dispose old one to create new
                ConnectWebview.currentPanel.dispose();
            } else {
                // Same provider? Just reveal
                ConnectWebview.currentPanel._panel.reveal(column);
                return;
            }
        }

        // Otherwise, create a new panel.
        const title = PROVIDER_CONFIG[provider]?.title || `Connect ${provider}`;
        const panel = vscode.window.createWebviewPanel(
            'connectWebview',
            title,
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'resources')]
            }
        );

        ConnectWebview.currentPanel = new ConnectWebview(panel, context.extensionUri, provider, onConnect);
    }

    public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, provider: string, onConnect: (data: any) => Promise<void>) {
        ConnectWebview.currentPanel = new ConnectWebview(panel, extensionUri, provider, onConnect);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, provider: string, onConnect: (data: any) => Promise<void>) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this.provider = provider;
        this._onConnect = onConnect;

        this._update();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async message => {
                if (message.command === 'connect') {
                    await this._onConnect(message.data);
                    this.dispose();
                }
            },
            null,
            this._disposables
        );
    }

    public dispose() {
        ConnectWebview.currentPanel = undefined;

        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private _update() {
        this._panel.webview.html = this._getHtmlForWebview();
    }

    private _getHtmlForWebview() {
        const config = PROVIDER_CONFIG[this.provider] || { title: `Connect ${this.provider}`, fields: [] };

        let fieldsHtml = '';
        config.fields.forEach(f => {
            const type = f.type || 'text';
            const val = f.value || '';
            const help = f.placeholder ? `placeholder="${f.placeholder}"` : '';
            // Default to true if undefined
            const isRequired = f.required !== false;
            const requiredAttr = isRequired ? 'required' : '';

            fieldsHtml += `
            <div class="form-group">
                <label for="${f.id}">${f.label}</label>
                <input type="${type}" id="${f.id}" name="${f.id}" value="${val}" ${help} ${requiredAttr}>
            </div>`;
        });

        let linksHtml = '';
        if (config.links) {
            linksHtml = `<div class="help-text">` + config.links.map(l => `<a href="${l.url}">${l.text}</a>`).join(' | ') + `</div>`;
        }

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${config.title}</title>
            <style>
                body {
                    background-color: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                    font-family: var(--vscode-font-family);
                    padding: 20px;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                }
                .container {
                    width: 100%;
                    max-width: 400px;
                    padding: 20px;
                    background: var(--vscode-editor-background);
                }
                h2 { margin-bottom: 20px; font-weight: 500; }
                .form-group { margin-bottom: 15px; text-align: left; }
                label { display: block; margin-bottom: 5px; font-size: 13px; font-weight: 500; }
                input {
                    width: 100%;
                    padding: 8px;
                    background: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 4px;
                    box-sizing: border-box;
                }
                input:focus { outline: 1px solid var(--vscode-focusBorder); border-color: var(--vscode-focusBorder); }
                .help-text { font-size: 12px; margin-top: 15px; opacity: 0.8; text-align: center; }
                a { color: var(--vscode-textLink-foreground); text-decoration: none; }
                a:hover { text-decoration: underline; }
                
                /* Button Color System */
                :root {
                    --btn-connect: #6c5ce7;      /* Purple */
                    --btn-connecting: #2d3436;   /* Dark */
                    --btn-connected: #00b894;    /* Teal */
                    --btn-text: #ffffff;
                }

                button {
                    background: var(--btn-connect); 
                    color: var(--btn-text);
                    border: none; padding: 12px 20px; border-radius: 4px; cursor: pointer;
                    font-weight: 600; font-size: 13px; margin-top: 15px; width: 100%;
                    box-shadow: 0 2px 5px rgba(0,0,0,0.2);
                    transition: all 0.2s ease;
                }
                button:hover { opacity: 0.9; transform: translateY(-1px); box-shadow: 0 4px 8px rgba(0,0,0,0.3); }
                button:active { transform: translateY(0); box-shadow: 0 2px 4px rgba(0,0,0,0.2); }
                
                button:disabled, button.connecting {
                    background: var(--btn-connecting);
                    cursor: wait;
                    box-shadow: none;
                    transform: none;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h2>${config.title}</h2>
                <form id="connectForm">
                    ${fieldsHtml}
                    <button type="submit">Connect</button>
                </form>
                ${linksHtml}
            </div>
            <script>
                const vscode = acquireVsCodeApi();
                const form = document.getElementById('connectForm');
                form.addEventListener('submit', (e) => {
                    e.preventDefault();
                    const btn = form.querySelector('button');
                    if (btn) {
                        btn.textContent = 'Connecting...';
                        btn.classList.add('connecting');
                        btn.disabled = true;
                    }
                    const data = {};
                    const inputs = form.querySelectorAll('input');
                    inputs.forEach(input => {
                        data[input.name] = input.value;
                    });
                    vscode.postMessage({ command: 'connect', data });
                });
            </script>
        </body>
        </html>`;
    }
}
