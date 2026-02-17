import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { CONFIG } from '../config';

export type SubscriptionStatus = 'none' | 'active' | 'expired';
type Capability = 'free.github' | 'free.codebase' | 'free.testing' | 'pro.connectors' | 'pro.tools';
type Entitlements = {
    planTier?: string;
    capabilities?: string[];
    capabilityOverrides?: { allow?: string[]; deny?: string[] } | null;
};

export class SubscriptionService {
    private static readonly TRIAL_DURATION_MS = 24 * 60 * 60 * 1000; // 24 Hours
    private static readonly TRIAL_START_KEY = 'flocca.trialStartDate';
    private static readonly SUB_STATUS_KEY = 'flocca.subscriptionStatus';
    private static readonly USER_ID_KEY = 'flocca.userId';
    private static readonly ENTITLEMENTS_KEY = 'flocca.entitlements';

    private _statusBarItem: vscode.StatusBarItem;
    private static readonly FREE_CAPABILITIES: ReadonlySet<Capability> = new Set([
        'free.github',
        'free.codebase',
        'free.testing'
    ]);

    private static readonly FEATURE_CAPABILITY_MAP: Record<string, Capability> = {
        github: 'free.github',
        codebase: 'free.codebase',
        pytest: 'free.testing',
        playwright: 'free.testing',
        mcp_tool: 'pro.tools'
    };

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

    private getRequiredCapability(feature: string): Capability {
        if (feature.startsWith('mcp_tool:')) {
            const serverName = feature.slice('mcp_tool:'.length);
            if (['github', 'pytest', 'playwright', 'codebase'].includes(serverName)) {
                return serverName === 'github'
                    ? 'free.github'
                    : serverName === 'codebase'
                        ? 'free.codebase'
                        : 'free.testing';
            }
            return 'pro.tools';
        }

        return SubscriptionService.FEATURE_CAPABILITY_MAP[feature] || 'pro.connectors';
    }

    public hasCapability(capability: Capability): boolean {
        const entitlements = this.getEntitlements();
        if (entitlements && Array.isArray(entitlements.capabilities) && entitlements.capabilities.length > 0) {
            return entitlements.capabilities.includes(capability);
        }
        if (SubscriptionService.FREE_CAPABILITIES.has(capability)) return true;
        return this.getStatus() === 'active';
    }

    public checkAccess(feature: string): boolean {
        return this.hasCapability(this.getRequiredCapability(feature));
    }

    public getEntitlements(): Entitlements | undefined {
        return this.context.globalState.get<Entitlements>(SubscriptionService.ENTITLEMENTS_KEY);
    }

    public async applyEntitlements(entitlements?: Entitlements) {
        await this.context.globalState.update(SubscriptionService.ENTITLEMENTS_KEY, entitlements || undefined);
        if (!entitlements) return;

        const caps = Array.isArray(entitlements.capabilities) ? entitlements.capabilities : [];
        const isPaid = caps.includes('pro.connectors') || caps.includes('pro.tools') ||
            ['pro', 'team', 'enterprise'].includes(entitlements.planTier || '');
        await this.context.globalState.update(SubscriptionService.SUB_STATUS_KEY, isPaid ? 'active' : undefined);
        this.updateStatusBar();
    }

    public isPaidUser(): boolean {
        const entitlements = this.getEntitlements();
        if (entitlements) {
            const caps = Array.isArray(entitlements.capabilities) ? entitlements.capabilities : [];
            if (caps.includes('pro.connectors') || caps.includes('pro.tools')) return true;
            if (['pro', 'team', 'enterprise'].includes(entitlements.planTier || '')) return true;
        }
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

    private static readonly API_BASE_URL = CONFIG.API_BASE;

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
        // Pricing page is a web page (not under /api).
        const url = `https://www.flocca.app/pricing?userId=${userId}&plan=${plan}&quantity=${quantity}`;

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
                const data = await res.json() as { plan: string, entitlements?: Entitlements };
                if (data.entitlements) {
                    await this.applyEntitlements(data.entitlements);
                }
                if (['individual', 'teams', 'team', 'pro', 'enterprise', 'active'].includes(data.plan)) {
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
