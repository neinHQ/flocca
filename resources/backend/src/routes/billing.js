const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// GET /billing/config - Get Public Key
router.get('/config', (req, res) => {
    res.json({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY });
});

// GET /billing/plans - Fetch dynamic pricing from Stripe
router.get('/plans', async (req, res) => {
    try {
        const prices = await Promise.all([
            stripe.prices.retrieve(process.env.STRIPE_PRICE_ID_INDIVIDUAL),
            stripe.prices.retrieve(process.env.STRIPE_PRICE_ID_TEAMS)
        ]);

        const formatPrice = (price) => {
            const amount = price.unit_amount / 100;
            return new Intl.NumberFormat('en-US', { style: 'currency', currency: price.currency }).format(amount);
        };

        res.json({
            individual: {
                id: prices[0].id,
                amount: formatPrice(prices[0]),
                interval: prices[0].recurring.interval
            },
            teams: {
                id: prices[1].id,
                amount: formatPrice(prices[1]),
                interval: prices[1].recurring.interval
            }
        });
    } catch (error) {
        console.error("Failed to fetch plans:", error);
        // Fallback if Stripe fails
        res.json({
            individual: { amount: '$15.00', interval: 'month' },
            teams: { amount: '$12.99', interval: 'month' }
        });
    }
});

// POST /checkout - Create a Stripe Checkout Session
router.post('/checkout', async (req, res) => {
    const { userId, successUrl, cancelUrl, plan = 'individual', quantity = 1 } = req.body;

    if (!userId) return res.status(400).send("Missing userId");
    if (!['individual', 'teams'].includes(plan)) return res.status(400).send("Invalid plan type");

    const priceId = plan === 'teams'
        ? process.env.STRIPE_PRICE_ID_TEAMS
        : process.env.STRIPE_PRICE_ID_INDIVIDUAL;

    if (!priceId) return res.status(500).send(`Price ID not configured for plan: ${plan}`);

    try {
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
            payment_method_types: ['card'],
            line_items: [
                {
                    price: priceId,
                    quantity: plan === 'teams' ? parseInt(quantity) || 1 : 1,
                },
            ],
            return_url: 'http://localhost:8080/return?session_id={CHECKOUT_SESSION_ID}',
            metadata: {
                userId,
                plan
            }
        });

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
    const customerEmail = session.customer_details?.email;

    if (user) {
        // Prepare update data
        const updateData = {
            subscriptionStatus: planType,
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
        console.log(`User ${user.id} upgraded to ${planType}. Email: ${customerEmail || 'N/A'}`);
    } else {
        console.error(`User not found for customer ${customerId}`);
    }
}

async function handleSubscriptionDeleted(sub) {
    const customerId = sub.customer;
    const user = await prisma.user.findFirst({ where: { stripeCustomerId: customerId } });

    if (user) {
        await prisma.user.update({
            where: { id: user.id },
            data: { subscriptionStatus: 'free' }
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

    res.json({
        plan: status,
        features: status === 'pro' ? ['zephyr', 'figma', 'jira'] : []
    });
});

module.exports = router;
