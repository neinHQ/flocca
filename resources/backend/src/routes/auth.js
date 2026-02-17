const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const crypto = require('crypto');
const { buildEntitlements } = require('../utils/entitlements');

// Helper: Hash password (simple sha256 for MVP)
const hashPassword = (password) => {
    return crypto.createHash('sha256').update(password).digest('hex');
};

// POST /auth/register
// Input: email, password, anonymousId (optional)
router.post('/register', async (req, res) => {
    const { email, password, anonymousId } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password required' });
    }

    try {
        const hashedPassword = hashPassword(password);

        // Check availability
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        let user;

        // Account Claiming: If anonymousId provided, update that user
        if (anonymousId) {
            const anonUser = await prisma.user.findUnique({ where: { id: anonymousId } });

            if (anonUser) {
                // Business Rule: Only Paid users can claim/register (as per user request)
                if (anonUser.subscriptionStatus === 'free') {
                    return res.status(403).json({ error: 'Registration is currently restricted to paid subscribers.' });
                }

                if (anonUser.email) {
                    // Start fresh if the ID is already claimed (weird edge case)
                } else {
                    user = await prisma.user.update({
                        where: { id: anonymousId },
                        data: { email, password: hashedPassword }
                    });
                    return res.json({
                        success: true,
                        user: {
                            id: user.id,
                            email: user.email,
                            subscriptionStatus: user.subscriptionStatus,
                            planTier: user.planTier,
                            entitlements: buildEntitlements(user)
                        },
                        claimed: true
                    });
                }
            }
        }

        // Create new user if no claim
        user = await prisma.user.create({
            data: {
                email,
                password: hashedPassword
            }
        });

        res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                subscriptionStatus: user.subscriptionStatus,
                planTier: user.planTier,
                entitlements: buildEntitlements(user)
            },
            claimed: false
        });

    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// POST /auth/login
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) return res.status(400).json({ error: 'Missing credentials' });

    try {
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || user.password !== hashPassword(password)) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // success
        res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                subscriptionStatus: user.subscriptionStatus,
                planTier: user.planTier,
                entitlements: buildEntitlements(user)
            }
        });
    } catch (e) {
        res.status(500).json({ error: 'Login failed' });
    }
});

// Helper for Social Login Logic
async function handleSocialLogin(res, providerField, providerId, email, anonymousId) {
    try {
        // 1. Try to find existing social user
        let user = await prisma.user.findUnique({ where: { [providerField]: providerId } });

        // 2. If not found by ID, try by Email (Link accounts)
        if (!user && email) {
            user = await prisma.user.findUnique({ where: { email } });
            if (user) {
                // Link the social ID to this existing email user
                user = await prisma.user.update({
                    where: { id: user.id },
                    data: { [providerField]: providerId }
                });
            }
        }

        // 3. If still new, check for Anonymous Claim
        if (!user) {
            if (anonymousId) {
                const anonUser = await prisma.user.findUnique({ where: { id: anonymousId } });
                if (anonUser) {
                    // Claim: Upgrade anonymous user
                    user = await prisma.user.update({
                        where: { id: anonymousId },
                        data: {
                            email: email || undefined, // Set email if provided
                            [providerField]: providerId
                        }
                    });
                }
            }
        }

        // 4. Finally, if no claim, create new
        if (!user) {
            user = await prisma.user.create({
                data: {
                    email: email || undefined,
                    [providerField]: providerId
                }
            });
        }

        // Redirect to Success Page
        // In real app: Generate JWT here.
        // For now: Notify VS Code via success page
        res.redirect(`/auth/success?source=social&id=${user.id}&email=${user.email || ''}`);

    } catch (e) {
        console.error('Social Login Error:', e);
        res.redirect('/auth/error?cause=social_login_failed');
    }
}

// GET /auth/github
router.get('/github', (req, res) => {
    const { anonymousId } = req.query;
    const redirect_uri = `${process.env.BASE_URL}/auth/github/callback`;
    const state = anonymousId || 'no_anon';
    const url = `https://github.com/login/oauth/authorize?client_id=${process.env.GITHUB_CLIENT_ID}&redirect_uri=${redirect_uri}&scope=user:email&state=${state}`;
    res.redirect(url);
});

// GET /auth/github/callback
router.get('/github/callback', async (req, res) => {
    const { code, state } = req.query;
    const anonymousId = state === 'no_anon' ? null : state;

    try {
        // 1. Exchange Code
        const tokenRes = await require('axios').post('https://github.com/login/oauth/access_token', {
            client_id: process.env.GITHUB_CLIENT_ID,
            client_secret: process.env.GITHUB_CLIENT_SECRET,
            code
        }, { headers: { Accept: 'application/json' } });

        const accessToken = tokenRes.data.access_token;
        if (!accessToken) throw new Error('No access token from GitHub');

        // 2. Get Profile
        const userRes = await require('axios').get('https://api.github.com/user', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        // 3. Get Email (if private)
        let email = userRes.data.email;
        if (!email) {
            const emailsRes = await require('axios').get('https://api.github.com/user/emails', {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            const primary = emailsRes.data.find(e => e.primary && e.verified);
            if (primary) email = primary.email;
        }

        await handleSocialLogin(res, 'githubId', String(userRes.data.id), email, anonymousId);

    } catch (e) {
        console.error(e);
        res.redirect('/auth/error');
    }
});

// GET /auth/gitlab
router.get('/gitlab', (req, res) => {
    const { anonymousId } = req.query;
    const redirect_uri = `${process.env.BASE_URL}/auth/gitlab/callback`;
    const state = anonymousId || 'no_anon';
    const url = `https://gitlab.com/oauth/authorize?client_id=${process.env.GITLAB_CLIENT_ID}&redirect_uri=${redirect_uri}&response_type=code&scope=read_user&state=${state}`;
    res.redirect(url);
});

// GET /auth/gitlab/callback
router.get('/gitlab/callback', async (req, res) => {
    const { code, state } = req.query;
    const anonymousId = state === 'no_anon' ? null : state;

    try {
        const tokenRes = await require('axios').post('https://gitlab.com/oauth/token', {
            client_id: process.env.GITLAB_CLIENT_ID,
            client_secret: process.env.GITLAB_CLIENT_SECRET,
            code,
            grant_type: 'authorization_code',
            redirect_uri: `${process.env.BASE_URL}/auth/gitlab/callback`
        });

        const accessToken = tokenRes.data.access_token;
        const userRes = await require('axios').get('https://gitlab.com/api/v4/user', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        await handleSocialLogin(res, 'gitlabId', String(userRes.data.id), userRes.data.email, anonymousId);

    } catch (e) {
        res.redirect('/auth/error');
    }
});

// GET /auth/entitlements?userId=...
router.get('/entitlements', async (req, res) => {
    const userId = req.query.userId || req.headers['x-flocca-user-id'];
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    try {
        const user = await prisma.user.findUnique({ where: { id: String(userId) } });
        if (!user) return res.status(404).json({ error: 'User not found' });
        return res.json({ entitlements: buildEntitlements(user) });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: 'Failed to load entitlements' });
    }
});

// POST /auth/entitlements
// Admin-only helper to set plan tier and capability overrides for a user.
router.post('/entitlements', async (req, res) => {
    const adminKey = req.headers['x-admin-key'];
    if (!process.env.ADMIN_API_KEY || adminKey !== process.env.ADMIN_API_KEY) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    const { userId, planTier, allow = [], deny = [] } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    try {
        const user = await prisma.user.update({
            where: { id: String(userId) },
            data: {
                ...(planTier ? { planTier: String(planTier) } : {}),
                capabilityOverrides: { allow, deny }
            }
        });

        return res.json({
            success: true,
            user: {
                id: user.id,
                planTier: user.planTier,
                subscriptionStatus: user.subscriptionStatus,
                entitlements: buildEntitlements(user)
            }
        });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: 'Failed to update entitlements' });
    }
});


module.exports = router;
