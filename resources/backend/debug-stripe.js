require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const sessionId = 'cs_test_a1RgHaAaxwR6YSx7aDQ1i4vyUkE5Mlqe8X2EKtm3pWlKiklvwHQAfbFKcp';

async function main() {
    try {
        const session = await stripe.checkout.sessions.retrieve(sessionId, {
            expand: ['subscription']
        });
        console.log("Session Status:", session.status);
        console.log("Metadata:", session.metadata);
        console.log("Customer:", session.customer);
        console.log("Email from Form:", session.customer_details?.email);
        console.log("Subscription:", session.subscription ? session.subscription.id : 'None');
    } catch (e) {
        console.error(e);
    }
}

main();
