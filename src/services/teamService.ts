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
                const e: any = new Error(err.error || `Request to ${path} failed`);
                e.status = res.status;
                e.payload = err;
                throw e;
            }
            return await res.json();
        } catch (e: any) {
            throw e;
        }
    }

    private async get(path: string): Promise<any> {
        const subs = new SubscriptionService(this.context);
        const userId = subs.getUserId();

        try {
            const res = await fetch(`${TeamService.API_BASE}${path}?userId=${userId}`);
            if (!res.ok) {
                const err = await res.json() as any;
                const e: any = new Error(err.error || `Request to ${path} failed`);
                e.status = res.status;
                e.payload = err;
                throw e;
            }
            return await res.json();
        } catch (e: any) {
            throw e;
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
        try {
            const res = await this.get('/teams/my');
            return Array.isArray(res) ? res : (res.teams || []);
        } catch {
            const res = await this.get('/teams');
            return Array.isArray(res) ? res : (res.teams || []);
        }
    }

    async getTeamMembers(teamId: string) {
        const res = await this.get(`/teams/${teamId}/members`);
        return Array.isArray(res) ? res : (res.members || []);
    }

    async getSeatSummary(teamId: string) {
        return this.get(`/teams/${teamId}/seats/summary`);
    }

    async getSeatAssignments(teamId: string) {
        const res = await this.get(`/teams/${teamId}/seats/assignments`);
        return res.assignments || [];
    }

    async getSkuCatalog() {
        const res = await this.get('/teams/skus/catalog');
        return res.skus || [];
    }

    async assignSkus(teamId: string, targetUserId: string, skus: string[]) {
        return this.post(`/teams/${teamId}/seats/assign`, { targetUserId, skus });
    }

    async topUpSeats(teamId: string, addSeats: number) {
        return this.post(`/teams/${teamId}/seats/topup`, { addSeats });
    }
}
