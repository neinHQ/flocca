const express = require('express');
const router = express.Router();
const prisma = require('../db');

// GET /connections?userId=...
router.get('/', async (req, res) => {
    const userId = req.query.userId || req.headers['x-flocca-user-id'];

    if (!userId) return res.json({ connected: [] });

    try {
        // 1. Get user's team IDs
        const memberships = await prisma.teamMember.findMany({
            where: { userId },
            select: { teamId: true }
        });
        const teamIds = memberships.map(m => m.teamId);

        // 2. Fetch Personal OR Team connections
        const connections = await prisma.connection.findMany({
            where: {
                OR: [
                    { userId: userId },
                    { teamId: { in: teamIds } }
                ]
            }
        });

        const statusMap = {};
        connections.forEach(c => {
            statusMap[c.provider] = {
                connected: true,
                lastUpdated: c.updatedAt,
                shared: !!c.teamId // Flag if shared
            };
        });

        res.json(statusMap);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
