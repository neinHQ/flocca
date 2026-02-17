const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { buildEntitlements } = require('../utils/entitlements');
const PLAN_MIN_SEATS = { individual: 1, teams: 3, enterprise: 10 };
const PLAN_PRICE_IDS = {
    individual: process.env.STRIPE_PRICE_ID_INDIVIDUAL,
    teams: process.env.STRIPE_PRICE_ID_TEAMS,
    enterprise: process.env.STRIPE_PRICE_ID_ENTERPRISE
};

// GET /billing/config - Get Public Key
router.get('/config', (req, res) => {
    res.json({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY });
});

// GET /billing/plans - Fetch dynamic pricing from Stripe
router.get('/plans', async (req, res) => {
    try {
        const plansToFetch = Object.entries(PLAN_PRICE_IDS).filter(([, priceId]) => !!priceId);
        const prices = await Promise.all(plansToFetch.map(([, priceId]) => stripe.prices.retrieve(priceId)));

        const formatPrice = (price) => {
            const amount = price.unit_amount / 100;
            return new Intl.NumberFormat('en-US', { style: 'currency', currency: price.currency }).format(amount);
        };

        const payload = {};
        plansToFetch.forEach(([plan], i) => {
            payload[plan] = {
                id: prices[i].id,
                amount: formatPrice(prices[i]),
                interval: prices[i].recurring.interval,
                minSeats: PLAN_MIN_SEATS[plan] || 1
            };
        });

        res.json(payload);
    } catch (error) {
        console.error("Failed to fetch plans:", error);
        // Fallback if Stripe fails
        res.json({
            individual: { amount: '$15.00', interval: 'month', minSeats: 1 },
            teams: { amount: '$12.99', interval: 'month', minSeats: 3 },
            enterprise: { amount: '$49.00', interval: 'month', minSeats: 10 }
        });
    }
});

// POST /checkout - Create a Stripe Checkout Session
router.post('/checkout', async (req, res) => {
    const { userId, teamId, successUrl, plan = 'individual', quantity = 1 } = req.body;

    if (!userId) return res.status(400).send("Missing userId");
    if (!['individual', 'teams', 'enterprise'].includes(plan)) return res.status(400).send("Invalid plan type");

    const parsedQty = Number.parseInt(String(quantity), 10);
    const minSeats = PLAN_MIN_SEATS[plan] || 1;
    const seats = Number.isFinite(parsedQty) && parsedQty > 0 ? parsedQty : minSeats;
    if (seats < minSeats) {
        return res.status(400).json({ error: `Minimum seats for ${plan} is ${minSeats}` });
    }

    const priceId = PLAN_PRICE_IDS[plan];

    if (!priceId) return res.status(500).send(`Price ID not configured for plan: ${plan}`);

    try {
        const appBaseUrl = process.env.BASE_URL || 'https://flocca.app';
        const returnUrl = (typeof successUrl === 'string' && successUrl.startsWith('http'))
            ? successUrl
            : `${appBaseUrl}/return?session_id={CHECKOUT_SESSION_ID}`;

        // 1. Get/Create User
        let user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            user = await prisma.user.create({ data: { id: userId } });
        }

        // 2. Get/Create Stripe Customer
        let customerId = user.stripeCustomerId;
        if (!customerId) {
            const customer = await stripe.customers.create({
                metadata: { userId: user.id }
            });
            customerId = customer.id;
            await prisma.user.update({
                where: { id: userId },
                data: { stripeCustomerId: customerId }
            });
        }

        // 3. Create Checkout Session
        const session = await stripe.checkout.sessions.create({
            customer: customerId,
            mode: 'subscription',
            ui_mode: 'embedded',
            payment_method_types: ['card', 'us_bank_account'],
            line_items: [
                {
                    price: priceId,
                    quantity: seats,
                },
            ],
            return_url: returnUrl,
            metadata: {
                userId,
                plan,
                seats: String(seats),
                teamId: teamId || ''
            }
        });

        if (teamId && ['teams', 'enterprise'].includes(plan)) {
            await prisma.team.update({
                where: { id: String(teamId) },
                data: {
                    billingUserId: userId,
                    seatPlan: plan
                }
            });
        }

        res.json({ clientSecret: session.client_secret });

    } catch (e) {
        console.error("Checkout Error:", e);
        res.status(500).json({ error: e.message });
    }
});
// GET /session-status - Check status of a checkout session
router.get('/session-status', async (req, res) => {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: 'Missing session_id' });

    try {
        const session = await stripe.checkout.sessions.retrieve(session_id);
        res.json({
            status: session.status, // 'open', 'complete', or 'expired'
            customer_email: session.customer_details?.email
        });
    } catch (e) {
        console.error("Failed to retrieve session:", e);
        res.status(500).json({ error: e.message });
    }
});
// POST /billing/webhook
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
        console.error(`Webhook Error: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle Events
    switch (event.type) {
        case 'checkout.session.completed':
            const session = event.data.object;
            await handleCheckoutCompleted(session);
            break;
        case 'customer.subscription.deleted':
            const sub = event.data.object;
            await handleSubscriptionDeleted(sub);
            break;
        default:
            console.log(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
});

async function handleCheckoutCompleted(session) {
    const customerId = session.customer;
    const subscriptionId = session.subscription;

    // Find user by stripeCustomerId
    const user = await prisma.user.findFirst({ where: { stripeCustomerId: customerId } });

    // Retrieve full session to get metadata (event data object usually has it if expandable, 
    // but checkout.session.completed object DEFINITELY has metadata)
    const planType = session.metadata?.plan || 'individual'; // Fallback
    const teamId = session.metadata?.teamId || null;
    const customerEmail = session.customer_details?.email;

    if (user) {
        // Prepare update data
        const updateData = {
            subscriptionStatus: planType,
            planTier: planType === 'teams' ? 'team' : (planType === 'enterprise' ? 'enterprise' : 'pro'),
            stripeSubscriptionId: subscriptionId
        };

        // Only update email if we don't have one (or maybe always? Let's say if null)
        if (customerEmail && !user.email) {
            updateData.email = customerEmail;
        }

        await prisma.user.update({
            where: { id: user.id },
            data: updateData
        });
        if (teamId && ['teams', 'enterprise'].includes(planType)) {
            await prisma.team.update({
                where: { id: String(teamId) },
                data: {
                    billingUserId: user.id,
                    seatPlan: planType
                }
            });
        }
        console.log(`User ${user.id} upgraded to ${planType}. Email: ${customerEmail || 'N/A'}`);
    } else {
        console.error(`User not found for customer ${customerId}`);
    }
}

// POST /billing/seats
// Increase/decrease seat count for team/enterprise subscriptions.
router.post('/seats', async (req, res) => {
    const { userId, quantity, plan } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    const user = await prisma.user.findUnique({ where: { id: String(userId) } });
    if (!user || !user.stripeSubscriptionId) {
        return res.status(404).json({ error: 'Active subscription not found' });
    }

    const subscriptionPlan = plan || user.subscriptionStatus;
    if (!['teams', 'enterprise'].includes(subscriptionPlan)) {
        return res.status(400).json({ error: 'Seat updates are only supported for teams/enterprise plans' });
    }

    const minSeats = PLAN_MIN_SEATS[subscriptionPlan];
    const parsedQty = Number.parseInt(String(quantity), 10);
    if (!Number.isFinite(parsedQty) || parsedQty < minSeats) {
        return res.status(400).json({ error: `Minimum seats for ${subscriptionPlan} is ${minSeats}` });
    }

    try {
        const subscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
        const preferredPriceId = PLAN_PRICE_IDS[subscriptionPlan];
        const subscriptionItem = subscription.items.data.find((i) => i.price.id === preferredPriceId) || subscription.items.data[0];

        if (!subscriptionItem) {
            return res.status(400).json({ error: 'No subscription item found for seat updates' });
        }

        const updated = await stripe.subscriptions.update(subscription.id, {
            items: [{ id: subscriptionItem.id, quantity: parsedQty }],
            proration_behavior: 'create_prorations'
        });

        const updatedItem = updated.items.data.find((i) => i.id === subscriptionItem.id);
        return res.json({
            success: true,
            plan: subscriptionPlan,
            seats: updatedItem?.quantity || parsedQty,
            subscriptionId: updated.id
        });
    } catch (e) {
        console.error('Seat update failed:', e);
        return res.status(500).json({ error: e.message });
    }
});

async function handleSubscriptionDeleted(sub) {
    const customerId = sub.customer;
    const user = await prisma.user.findFirst({ where: { stripeCustomerId: customerId } });

    if (user) {
        await prisma.team.updateMany({
            where: { billingUserId: user.id },
            data: { seatPlan: 'free' }
        });
        await prisma.user.update({
            where: { id: user.id },
            data: { subscriptionStatus: 'free', planTier: 'free' }
        });
        console.log(`User ${user.id} downgraded to FREE`);
    }
}

// GET /billing/status
router.get('/status', async (req, res) => {
    const userId = req.query.userId || req.headers['x-flocca-user-id'];
    if (!userId) return res.json({ plan: 'free' });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    const status = user?.subscriptionStatus || 'free';
    const entitlements = buildEntitlements(user);

    res.json({
        planTier: entitlements.planTier,
        plan: status,
        minSeats: PLAN_MIN_SEATS[status] || 1,
        entitlements,
        features: entitlements.capabilities
    });
});

module.exports = router;
