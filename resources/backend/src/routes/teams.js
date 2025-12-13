const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const crypto = require('crypto');

// Middleware to get userId from headers (simulated auth)
const getUserId = (req) => req.headers['x-flocca-user-id'] || req.query.userId;

// GET /teams - List teams for the current user
router.get('/', async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const memberships = await prisma.teamMember.findMany({
            where: { userId },
            include: { team: true }
        });
        res.json(memberships.map(m => ({ ...m.team, role: m.role })));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /teams - Create a new team
router.post('/', async (req, res) => {
    const userId = getUserId(req);
    const { name } = req.body;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!name) return res.status(400).json({ error: 'Team name is required' });

    try {
        // Ensure user exists
        await prisma.user.upsert({
            where: { id: userId },
            update: {},
            create: { id: userId }
        });

        const team = await prisma.team.create({
            data: {
                name,
                members: {
                    create: { userId, role: 'OWNER' }
                }
            }
        });
        res.json(team);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /teams/invite - Generate an invite code (Admin/Owner only)
router.post('/invite', async (req, res) => {
    const userId = getUserId(req);
    const { teamId } = req.body;

    if (!userId || !teamId) return res.status(400).json({ error: 'Missing userId or teamId' });

    try {
        // Check permissions
        const member = await prisma.teamMember.findUnique({
            where: { userId_teamId: { userId, teamId } }
        });

        if (!member || (member.role !== 'OWNER' && member.role !== 'ADMIN')) {
            return res.status(403).json({ error: 'Only Admins can generate invites' });
        }

        // Generate Code (e.g., FL-8A2B)
        const code = `FL-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7); // Valid for 7 days

        const invite = await prisma.inviteCode.create({
            data: { code, teamId, expiresAt }
        });

        res.json({ code: invite.code, expiresAt: invite.expiresAt });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /teams/join - Join a team using a code
router.post('/join', async (req, res) => {
    const userId = getUserId(req);
    const { code } = req.body;

    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!code) return res.status(400).json({ error: 'Invite code required' });

    try {
        // Ensure user exists
        await prisma.user.upsert({
            where: { id: userId },
            update: {},
            create: { id: userId }
        });

        const invite = await prisma.inviteCode.findUnique({
            where: { code },
            include: { team: true }
        });

        if (!invite) return res.status(404).json({ error: 'Invalid invite code' });
        if (new Date() > invite.expiresAt) return res.status(400).json({ error: 'Invite expired' });

        // Check if already a member
        const existing = await prisma.teamMember.findUnique({
            where: { userId_teamId: { userId, teamId: invite.teamId } }
        });

        if (existing) return res.status(400).json({ error: 'Already a member of this team' });

        // Add to team
        await prisma.teamMember.create({
            data: { userId, teamId: invite.teamId, role: 'MEMBER' }
        });

        res.json({ success: true, teamName: invite.team.name });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /teams/:teamId/members - List members
router.get('/:teamId/members', async (req, res) => {
    const userId = getUserId(req);
    const { teamId } = req.params;

    try {
        // Check membership first
        const me = await prisma.teamMember.findUnique({
            where: { userId_teamId: { userId, teamId } }
        });
        if (!me) return res.status(403).json({ error: 'Not a member of this team' });

        const members = await prisma.teamMember.findMany({
            where: { teamId },
            include: { user: { select: { id: true, subscriptionStatus: true } } }
        });

        res.json(members);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
