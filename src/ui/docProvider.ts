import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class DocProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'flocca-docs';
    private _view?: vscode.WebviewView;
    private _currentAgent: string = 'overview';
    private _currentLang: string = 'en';

    private readonly languages = [
        { code: 'en', name: 'English' },
        { code: 'zh', name: '中文' },
        { code: 'ja', name: '日本語' },
        { code: 'ko', name: '한국어' },
        { code: 'fr', name: 'Français' },
        { code: 'de', name: 'Deutsch' },
        { code: 'es', name: 'Español' },
        { code: 'pt', name: 'Português' },
        { code: 'ru', name: 'Русский' },
        { code: 'it', name: 'Italiano' },
        { code: 'pl', name: 'Polski' },
        { code: 'tr', name: 'Türkçe' }
    ];

    constructor(
        private readonly _extensionUri: vscode.Uri
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

        this.updateHtml();

        webviewView.webview.onDidReceiveMessage(message => {
            switch (message.type) {
                case 'changeLang':
                    this._currentLang = message.lang;
                    this.updateHtml();
                    break;
            }
        });
    }

    public showDoc(agentId: string) {
        this._currentAgent = agentId;
        if (this._view) {
            this._view.show?.(true); // Reveal if hidden
            this.updateHtml();
        }
    }

    private updateHtml() {
        if (!this._view) return;

        let content = 'Loading...';
        try {
            // Try specific lang, fallback to en
            const docPath = path.join(this._extensionUri.fsPath, 'resources', 'docs', this._currentLang, `${this._currentAgent}.md`);
            if (fs.existsSync(docPath)) {
                content = fs.readFileSync(docPath, 'utf8');
            } else {
                // Fallback to English
                const enPath = path.join(this._extensionUri.fsPath, 'resources', 'docs', 'en', `${this._currentAgent}.md`);
                if (fs.existsSync(enPath)) {
                    content = fs.readFileSync(enPath, 'utf8');
                    content = `> *Note: Documentation not available in ${this._currentLang}, showing English.*\n\n` + content;
                } else {
                    content = `# Doc Not Found\nSorry, no documentation found for **${this._currentAgent}**.`;
                }
            }
        } catch (e) {
            content = `Error loading docs: ${e}`;
        }

        this._view.webview.html = this.getHtml(this.renderMarkdown(content));
    }

    private renderMarkdown(md: string): string {
        // Very basic simple markdown parser
        let html = md
            .replace(/^# (.*$)/gim, '<h1>$1</h1>')
            .replace(/^## (.*$)/gim, '<h2>$1</h2>')
            .replace(/^### (.*$)/gim, '<h3>$1</h3>')
            .replace(/\*\*(.*)\*\*/gim, '<b>$1</b>')
            .replace(/\*(.*)\*/gim, '<i>$1</i>')
            .replace(/`(.*?)`/gim, '<code>$1</code>')
            .replace(/\n/gim, '<br>');

        // Handle code blocks (simplistic)
        html = html.replace(/```([\s\S]*?)```/gim, '<pre><code>$1</code></pre>');

        return html;
    }

    private getHtml(contentHtml: string) {
        const langOptions = this.languages.map(l =>
            `<option value="${l.code}" ${l.code === this._currentLang ? 'selected' : ''}>${l.name}</option>`
        ).join('');

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body { font-family: var(--vscode-font-family); padding: 10px; color: var(--vscode-foreground); }
                h1, h2, h3 { color: var(--vscode-editor-foreground); }
                pre { background: var(--vscode-textBlockQuote-background); padding: 10px; border-radius: 4px; overflow-x: auto; }
                code { font-family: var(--vscode-editor-font-family); }
                select { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border); padding: 4px; margin-bottom: 15px; }
            </style>
        </head>
        <body>
            <select onchange="changeLang(this.value)">
                ${langOptions}
            </select>
            <div id="content">
                ${contentHtml}
            </div>
            <script>
                const vscode = acquireVsCodeApi();
                function changeLang(lang) {
                    vscode.postMessage({ type: 'changeLang', lang: lang });
                }
            </script>
        </body>
        </html>`;
    }
}
