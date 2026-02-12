import * as vscode from 'vscode';
import { SubscriptionService } from './subscriptionService';
import { CONFIG } from '../config';

export class TeamService {
    private static readonly API_BASE = CONFIG.API_BASE;

    constructor(private context: vscode.ExtensionContext) { }

    private async post(path: string, body: any): Promise<any> {
        const subs = new SubscriptionService(this.context);
        const userId = subs.getUserId();

        try {
            const res = await fetch(`${TeamService.API_BASE}${path}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...body, userId }) // Always inject userId
            });

            if (!res.ok) {
                const err = await res.json() as any;
                throw new Error(err.error || `Request to ${path} failed`);
            }
            return await res.json();
        } catch (e: any) {
            throw new Error(e.message);
        }
    }

    private async get(path: string): Promise<any> {
        const subs = new SubscriptionService(this.context);
        const userId = subs.getUserId();

        try {
            const res = await fetch(`${TeamService.API_BASE}${path}?userId=${userId}`);
            if (!res.ok) {
                const err = await res.json() as any;
                throw new Error(err.error || `Request to ${path} failed`);
            }
            return await res.json();
        } catch (e: any) {
            throw new Error(e.message);
        }
    }

    async createTeam(name: string) {
        return this.post('/teams', { name });
    }

    async createInvite(teamId: string) {
        return this.post('/teams/invite', { teamId });
    }

    async joinTeam(code: string) {
        return this.post('/teams/join', { code });
    }

    async getMyTeams() {
        const res = await this.get('/teams/my');
        return res.teams || [];
    }

    async getTeamMembers(teamId: string) {
        const res = await this.get(`/teams/${teamId}/members`);
        return res.members || [];
    }
}
