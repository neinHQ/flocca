import * as vscode from 'vscode';
import * as crypto from 'crypto';

export type SubscriptionStatus = 'none' | 'active' | 'expired';

export class SubscriptionService {
    private static readonly TRIAL_DURATION_MS = 24 * 60 * 60 * 1000; // 24 Hours
    private static readonly TRIAL_START_KEY = 'flocca.trialStartDate';
    private static readonly SUB_STATUS_KEY = 'flocca.subscriptionStatus';
    private static readonly USER_ID_KEY = 'flocca.userId';

    private _statusBarItem: vscode.StatusBarItem;

    constructor(private context: vscode.ExtensionContext) {
        // Initialize User ID
        if (!this.context.globalState.get(SubscriptionService.USER_ID_KEY)) {
            this.context.globalState.update(SubscriptionService.USER_ID_KEY, crypto.randomUUID());
        }

        // Initialize trial on first run
        if (!this.context.globalState.get(SubscriptionService.TRIAL_START_KEY)) {
            this.context.globalState.update(SubscriptionService.TRIAL_START_KEY, Date.now());
        }

        this._statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this._statusBarItem.command = 'flocca.upgrade';
        this.updateStatusBar();
        this._statusBarItem.show();
    }

    public getUserId(): string {
        return this.context.globalState.get<string>(SubscriptionService.USER_ID_KEY) || 'unknown';
    }

    public async setUserId(userId: string) {
        await this.context.globalState.update(SubscriptionService.USER_ID_KEY, userId);
    }

    public async setEmail(email: string) {
        await this.context.globalState.update('flocca.email', email);
    }

    public getEmail(): string | undefined {
        return this.context.globalState.get<string>('flocca.email');
    }

    public getStatus(): SubscriptionStatus {
        const status = this.context.globalState.get<string>(SubscriptionService.SUB_STATUS_KEY);
        if (status === 'active') return 'active';

        const start = this.context.globalState.get<number>(SubscriptionService.TRIAL_START_KEY) || Date.now();
        const elapsed = Date.now() - start;

        if (elapsed < SubscriptionService.TRIAL_DURATION_MS) {
            return 'active'; // In Trial
        }

        return 'expired';
    }

    public checkAccess(feature: string): boolean {
        // Free Features
        if (['github', 'codebase'].includes(feature)) return true;

        const status = this.getStatus();
        return status === 'active';
    }

    public isPaidUser(): boolean {
        // 'active' stored explicitly means Paid. Missing means Trial.
        return this.context.globalState.get<string>(SubscriptionService.SUB_STATUS_KEY) === 'active';
    }

    public updateStatusBar() {
        const status = this.getStatus();
        const isTrial = !this.context.globalState.get(SubscriptionService.SUB_STATUS_KEY); // Active but no explicit 'active' stored means trial

        if (status === 'active') {
            if (isTrial) {
                this._statusBarItem.text = "$(clock) Flocca Trial";
                this._statusBarItem.tooltip = "Click to Upgrade to Pro";
                this._statusBarItem.backgroundColor = undefined;
            } else {
                this._statusBarItem.text = "$(check) Flocca Pro";
                this._statusBarItem.tooltip = "Subscription Active";
                this._statusBarItem.backgroundColor = undefined;
            }
        } else {
            this._statusBarItem.text = "$(lock) Flocca Expired";
            this._statusBarItem.tooltip = "Trial Expired. Click to Upgrade.";
            this._statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        }
    }

    private static readonly API_BASE_URL = 'http://localhost:3000'; // Configurable in real app

    // Fetch Plans from Backend
    public async getPlans() {
        try {
            const response = await fetch(`${SubscriptionService.API_BASE_URL}/billing/plans`);
            if (response.ok) {
                return await response.json();
            }
        } catch (e) {
            console.error("Failed to fetch plans", e);
        }
        // Client-side fallback if backend unreachable
        return {
            individual: { amount: '$15.00', interval: 'month' },
            teams: { amount: '$12.99', interval: 'month' }
        };
    }

    // Public entry point to show UI
    public async upgradeToPro() {
        const { SubscriptionProvider } = require('../ui/subscriptionProvider');
        const provider = new SubscriptionProvider(this.context.extensionUri, this);
        provider.show();
    }

    public async openPricingPage(plan: string, quantity: number) {
        const userId = this.getUserId();
        // Open local website with params
        // Website runs on port 3000
        const url = `http://localhost:3000/pricing?userId=${userId}&plan=${plan}&quantity=${quantity}`;

        await vscode.env.openExternal(vscode.Uri.parse(url));

        // Start polling immediately
        this.pollWithBackoff();
    }



    private async pollWithBackoff() {
        // Poll for 2 minutes
        const start = Date.now();
        while (Date.now() - start < 120000) {
            const active = await this.pollSubscriptionStatus();
            if (active) {
                vscode.window.showInformationMessage('Subscription Activated! Thank you for supporting Flocca. 🎉');
                return;
            }
            await new Promise(r => setTimeout(r, 2000)); // 2s interval
        }
    }

    public async pollSubscriptionStatus(): Promise<boolean> {
        try {
            const userId = this.getUserId();
            // but VS Code maintains Node env. Node 18+ has fetch.
            const res = await fetch(`${SubscriptionService.API_BASE_URL}/billing/status?userId=${userId}`);
            if (res.ok) {
                const data = await res.json() as { plan: string };
                if (['individual', 'teams', 'pro'].includes(data.plan)) {
                    await this.context.globalState.update(SubscriptionService.SUB_STATUS_KEY, 'active');
                    this.updateStatusBar();
                    return true;
                }
            }
        } catch (e) {
            console.error('Subscription Poll Failed:', e);
        }
        return false;
    }

    public async resetTrial() {
        // Debug only
        await this.context.globalState.update(SubscriptionService.TRIAL_START_KEY, Date.now());
        await this.context.globalState.update(SubscriptionService.SUB_STATUS_KEY, undefined);
        this.updateStatusBar();
        vscode.window.showInformationMessage('Flocca: Trial Reset.');
    }

    public async expireTrial() {
        // Debug only: force expire locally
        await this.context.globalState.update(SubscriptionService.TRIAL_START_KEY, Date.now() - SubscriptionService.TRIAL_DURATION_MS - 1000);
        await this.context.globalState.update(SubscriptionService.SUB_STATUS_KEY, undefined);
        this.updateStatusBar();
        vscode.window.showInformationMessage('Flocca: Trial Expired.');
    }
}
