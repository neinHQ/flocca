import * as vscode from 'vscode';
import { SubscriptionService } from '../services/subscriptionService';

export class SubscriptionProvider {
    public static readonly viewType = 'flocca.subscriptionInput';

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _subService: SubscriptionService
    ) { }

    public show() {
        const panel = vscode.window.createWebviewPanel(
            SubscriptionProvider.viewType,
            'Upgrade to Flocca Pro',
            vscode.ViewColumn.Active,
            {
                enableScripts: true,
                localResourceRoots: [this._extensionUri]
            }
        );

        panel.webview.html = this._getHtmlForWebview(panel.webview);

        panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'checkout':
                        const { plan, quantity } = message;
                        panel.dispose();
                        // Redirect to Website with params
                        await this._subService.openPricingPage(plan, quantity);
                        return;
                }
            },
            undefined,
            []
        );
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Upgrade Plan</title>
             <style>
                body { 
                    font-family: var(--vscode-font-family); 
                    color: var(--vscode-foreground); 
                    background-color: var(--vscode-editor-background);
                    display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0;
                }
                .container { text-align: center; max-width: 800px; padding: 20px; }
                
                h1 { font-size: 2em; margin-bottom: 0.5em; background: linear-gradient(90deg, #FFD700, #FF6B6B); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
                p.subtitle { opacity: 0.8; font-size: 1.1em; margin-bottom: 40px; }

                .plans { display: flex; gap: 20px; justify-content: center; flex-wrap: wrap; }
                
                .card {
                    background: var(--vscode-sideBar-background);
                    border: 1px solid var(--vscode-widget-border);
                    border-radius: 12px;
                    padding: 24px;
                    width: 300px;
                    text-align: left;
                    transition: transform 0.2s, border-color 0.2s;
                    cursor: pointer;
                    display: flex; flex-direction: column;
                }
                .card:hover { transform: translateY(-3px); border-color: #6c5ce7; }
                .card.selected { border: 2px solid #6c5ce7; box-shadow: 0 0 15px rgba(108, 92, 231, 0.3); }

                .plan-header { margin-bottom: 20px; }
                .plan-name { font-size: 1.4em; font-weight: bold; margin-bottom: 5px; }
                .price { font-size: 2em; font-weight: bold; color: #6c5ce7; }
                .price span { font-size: 0.5em; color: var(--vscode-descriptionForeground); font-weight: normal; }
                
                ul.features { list-style: none; padding: 0; margin: 0 0 20px 0; font-size: 0.9em; opacity: 0.9; }
                ul.features li { margin-bottom: 8px; display: flex; align-items: center; }
                ul.features li::before { content: '✓'; color: #4CAF50; margin-right: 8px; font-weight: bold; }
                
                .spacer { flex: 1; }

                #seat-config { 
                    margin-top: 15px; padding-top: 15px; border-top: 1px solid var(--vscode-widget-border); 
                    display: none; 
                }
                label { display: block; margin-bottom: 8px; font-weight: bold; font-size: 0.9em; }
                input[type="number"] {
                    background: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    padding: 8px; border-radius: 4px; width: 100%; box-sizing: border-box;
                }

                .btn-primary {
                    background: linear-gradient(90deg, #6c5ce7, #a29bfe);
                    color: white; border: none; padding: 12px 30px; border-radius: 6px;
                    font-size: 1.1em; font-weight: bold; cursor: pointer; margin-top: 40px;
                    width: 100%; max-width: 300px; transition: opacity 0.2s;
                }
                .btn-primary:hover { opacity: 0.9; }

                .seat-help { font-size: 12px; opacity: 0.7; margin-top: 6px; }

            </style>
        </head>
        <body>
            <div class="container">
                <h1>Unlock Full Power</h1>
                <p class="subtitle">Orchestrate your entire toolchain with Flocca Pro.</p>

                <div class="plans">
                    <!-- Individual -->
                    <div class="card selected" id="plan-individual" onclick="selectPlan('individual')">
                        <div class="plan-header">
                            <div class="plan-name">Individual</div>
                            <div class="price">$5.99<span>/mo</span></div>
                        </div>
                        <ul class="features">
                            <li>Unlimited Vault Storage</li>
                            <li>Pro Integrations (Jira, AWS)</li>
                            <li>Visual Workflow Editor</li>
                            <li>Priority Support</li>
                        </ul>
                        <div class="spacer"></div>
                    </div>

                    <!-- Teams -->
                    <div class="card" id="plan-teams" onclick="selectPlan('teams')">
                        <div class="plan-header">
                            <div class="plan-name">Teams</div>
                            <div class="price">$12.99<span>/user</span></div>
                        </div>
                        <ul class="features">
                            <li>All Individual Features</li>
                            <li>Team Sharing & Sync</li>
                            <li>Governance & Audit Logs</li>
                            <li>SSO / SAML Support</li>
                        </ul>
                        <div class="spacer"></div>
                    </div>

                    <!-- Enterprise -->
                    <div class="card" id="plan-enterprise" onclick="selectPlan('enterprise')">
                        <div class="plan-header">
                            <div class="plan-name">Enterprise</div>
                            <div class="price">$24.99<span>/seat/mo</span></div>
                        </div>
                        <ul class="features">
                            <li>Advanced Role-Based Controls</li>
                            <li>Seat & SKU Assignment</li>
                            <li>Governance at Scale</li>
                            <li>Priority Enterprise Support</li>
                        </ul>
                        <div class="spacer"></div>
                    </div>
                </div>

                <div id="seat-config" onclick="event.stopPropagation()">
                    <label id="seat-label">Number of Seats</label>
                    <input type="number" id="seats" value="3" min="3">
                    <div class="seat-help" id="seat-help">Minimum 3 seats for Teams</div>
                </div>

                <div style="text-align:center;">
                     <button class="btn-primary" onclick="submit()">Proceed to Checkout</button>
                </div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                let currentPlan = 'individual';

                function selectPlan(plan) {
                    currentPlan = plan;
                    document.querySelectorAll('.card').forEach(c => c.classList.remove('selected'));
                    document.getElementById('plan-' + plan).classList.add('selected');

                    const config = document.getElementById('seat-config');
                    const seatsInput = document.getElementById('seats');
                    const seatHelp = document.getElementById('seat-help');
                    const seatLabel = document.getElementById('seat-label');

                    if (plan === 'teams' || plan === 'enterprise') {
                        config.style.display = 'block';
                        if (plan === 'teams') {
                            seatsInput.min = '3';
                            if (parseInt(seatsInput.value || '0', 10) < 3) seatsInput.value = '3';
                            seatLabel.textContent = 'Number of Seats (Teams)';
                            seatHelp.textContent = 'Minimum 3 seats for Teams';
                        } else {
                            seatsInput.min = '10';
                            if (parseInt(seatsInput.value || '0', 10) < 10) seatsInput.value = '10';
                            seatLabel.textContent = 'Number of Seats (Enterprise)';
                            seatHelp.textContent = 'Minimum 10 seats for Enterprise';
                        }
                    } else {
                        config.style.display = 'none';
                    }
                }

                function submit() {
                    const quantity = (currentPlan === 'teams' || currentPlan === 'enterprise')
                        ? document.getElementById('seats').value
                        : 1;
                    vscode.postMessage({
                        command: 'checkout',
                        plan: currentPlan,
                        quantity: parseInt(quantity)
                    });
                }
            </script>
        </body>
        </html>`;
    }
}
