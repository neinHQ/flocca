const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const crypto = require('crypto');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { listSkus, validateSkus } = require('../utils/skuCatalog');

const PLAN_MIN_SEATS = { teams: 3, enterprise: 10 };
const PLAN_PRICE_IDS = {
    teams: process.env.STRIPE_PRICE_ID_TEAMS,
    enterprise: process.env.STRIPE_PRICE_ID_ENTERPRISE
};

// Middleware to get userId from headers (simulated auth)
const getUserId = (req) => req.headers['x-flocca-user-id'] || req.query.userId;
const hasAdminAccess = (role) => role === 'OWNER' || role === 'ADMIN';

async function getMembership(userId, teamId) {
    return prisma.teamMember.findUnique({
        where: { userId_teamId: { userId, teamId } }
    });
}

async function getSeatContext(teamId) {
    const team = await prisma.team.findUnique({
        where: { id: teamId },
        include: {
            billingUser: true,
            members: true
        }
    });
    if (!team) return null;

    const used = team.members.filter((m) => Array.isArray(m.assignedSkus) && m.assignedSkus.length > 0).length;
    const plan = team.seatPlan || 'free';
    const minIncrement = PLAN_MIN_SEATS[plan] || 0;

    let purchased = 0;
    if (team.billingUser?.stripeSubscriptionId && ['teams', 'enterprise'].includes(plan)) {
        const subscription = await stripe.subscriptions.retrieve(team.billingUser.stripeSubscriptionId);
        const preferredPriceId = PLAN_PRICE_IDS[plan];
        const item = subscription.items.data.find((i) => i.price.id === preferredPriceId) || subscription.items.data[0];
        purchased = item?.quantity || 0;
    }

    return {
        team,
        plan,
        minIncrement,
        purchased,
        used,
        available: Math.max(0, purchased - used)
    };
}

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
                billingUserId: userId,
                seatPlan: 'free',
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

// GET /teams/skus/catalog - list available seat SKUs
router.get('/skus/catalog', async (_req, res) => {
    return res.json({ skus: listSkus() });
});

// GET /teams/:teamId/seats/summary
router.get('/:teamId/seats/summary', async (req, res) => {
    const userId = getUserId(req);
    const { teamId } = req.params;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const member = await getMembership(userId, teamId);
    if (!member) return res.status(403).json({ error: 'Not a member of this team' });

    try {
        const seatCtx = await getSeatContext(teamId);
        if (!seatCtx) return res.status(404).json({ error: 'Team not found' });
        return res.json({
            plan: seatCtx.plan,
            seatsPurchased: seatCtx.purchased,
            seatsUsed: seatCtx.used,
            seatsAvailable: seatCtx.available,
            topUpMinimum: seatCtx.minIncrement
        });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

// GET /teams/:teamId/seats/assignments
router.get('/:teamId/seats/assignments', async (req, res) => {
    const userId = getUserId(req);
    const { teamId } = req.params;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const member = await getMembership(userId, teamId);
    if (!member) return res.status(403).json({ error: 'Not a member of this team' });

    try {
        const members = await prisma.teamMember.findMany({
            where: { teamId },
            include: { user: { select: { id: true, email: true } } }
        });
        return res.json({
            assignments: members.map((m) => ({
                userId: m.userId,
                email: m.user?.email || null,
                role: m.role,
                skus: Array.isArray(m.assignedSkus) ? m.assignedSkus : []
            }))
        });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

// POST /teams/:teamId/seats/assign
// Body: { targetUserId, skus: [] }
router.post('/:teamId/seats/assign', async (req, res) => {
    const userId = getUserId(req);
    const { teamId } = req.params;
    const { targetUserId, skus = [] } = req.body || {};
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!targetUserId) return res.status(400).json({ error: 'targetUserId required' });
    if (!validateSkus(skus)) return res.status(400).json({ error: 'Invalid SKU selection' });

    const me = await getMembership(userId, teamId);
    if (!me || !hasAdminAccess(me.role)) {
        return res.status(403).json({ error: 'Only OWNER/ADMIN can assign seats' });
    }

    try {
        const target = await getMembership(targetUserId, teamId);
        if (!target) return res.status(404).json({ error: 'Target user is not in this team' });

        const seatCtx = await getSeatContext(teamId);
        if (!seatCtx) return res.status(404).json({ error: 'Team not found' });

        const currentSkus = Array.isArray(target.assignedSkus) ? target.assignedSkus : [];
        const currentConsumesSeat = currentSkus.length > 0;
        const nextConsumesSeat = skus.length > 0;

        let projectedUsed = seatCtx.used;
        if (!currentConsumesSeat && nextConsumesSeat) projectedUsed += 1;
        if (currentConsumesSeat && !nextConsumesSeat) projectedUsed -= 1;

        if (projectedUsed > seatCtx.purchased) {
            const needed = projectedUsed - seatCtx.purchased;
            const topUpMinimum = seatCtx.minIncrement || (seatCtx.plan === 'enterprise' ? 10 : 3);
            return res.status(409).json({
                error: 'Seat limit exceeded',
                seats: {
                    plan: seatCtx.plan,
                    purchased: seatCtx.purchased,
                    used: projectedUsed,
                    requiredAdditional: needed,
                    topUpMinimum,
                    recommendedTopUp: Math.max(topUpMinimum, needed)
                }
            });
        }

        await prisma.teamMember.update({
            where: { userId_teamId: { userId: targetUserId, teamId } },
            data: { assignedSkus: skus }
        });

        return res.json({
            success: true,
            userId: targetUserId,
            skus,
            seats: {
                plan: seatCtx.plan,
                purchased: seatCtx.purchased,
                used: projectedUsed,
                available: Math.max(0, seatCtx.purchased - projectedUsed)
            }
        });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

// POST /teams/:teamId/seats/topup
// Body: { addSeats }
router.post('/:teamId/seats/topup', async (req, res) => {
    const userId = getUserId(req);
    const { teamId } = req.params;
    const { addSeats } = req.body || {};
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const me = await getMembership(userId, teamId);
    if (!me || !hasAdminAccess(me.role)) {
        return res.status(403).json({ error: 'Only OWNER/ADMIN can top up seats' });
    }

    try {
        const seatCtx = await getSeatContext(teamId);
        if (!seatCtx) return res.status(404).json({ error: 'Team not found' });
        if (!['teams', 'enterprise'].includes(seatCtx.plan)) {
            return res.status(400).json({ error: 'Top-up only supported for teams/enterprise plans' });
        }

        const minIncrement = seatCtx.minIncrement;
        const parsedAdd = Number.parseInt(String(addSeats), 10);
        if (!Number.isFinite(parsedAdd) || parsedAdd < minIncrement) {
            return res.status(400).json({ error: `Minimum top-up for ${seatCtx.plan} is ${minIncrement}` });
        }

        const billingUser = seatCtx.team.billingUser;
        if (!billingUser?.stripeSubscriptionId) {
            return res.status(404).json({ error: 'Billing subscription not configured for this team' });
        }

        const subscription = await stripe.subscriptions.retrieve(billingUser.stripeSubscriptionId);
        const preferredPriceId = PLAN_PRICE_IDS[seatCtx.plan];
        const item = subscription.items.data.find((i) => i.price.id === preferredPriceId) || subscription.items.data[0];
        if (!item) return res.status(400).json({ error: 'No subscription item found' });

        const newQuantity = (item.quantity || 0) + parsedAdd;
        const updated = await stripe.subscriptions.update(subscription.id, {
            items: [{ id: item.id, quantity: newQuantity }],
            proration_behavior: 'create_prorations'
        });

        const updatedItem = updated.items.data.find((i) => i.id === item.id);
        return res.json({
            success: true,
            plan: seatCtx.plan,
            addedSeats: parsedAdd,
            seatsPurchased: updatedItem?.quantity || newQuantity
        });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

module.exports = router;
