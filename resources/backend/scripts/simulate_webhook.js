const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config({ path: '../.env' });

const SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const PORT = process.env.PORT || 3000;

if (!SECRET) {
    console.error("Error: STRIPE_WEBHOOK_SECRET not found in .env");
    process.exit(1);
}

// Mock Payload: checkout.session.completed
const payload = {
    id: 'evt_test_webhook',
    object: 'event',
    api_version: '2023-10-16',
    created: Math.floor(Date.now() / 1000),
    type: 'checkout.session.completed',
    data: {
        object: {
            id: 'cs_test_session_123',
            object: 'checkout.session',
            customer: 'cus_test_simulated',
            subscription: 'sub_test_simulated',
            payment_status: 'paid',
            status: 'complete'
        }
    }
};

const payloadString = JSON.stringify(payload);
const timestamp = Math.floor(Date.now() / 1000);

// Generate Signature
const signedPayload = `${timestamp}.${payloadString}`;
const hmac = crypto.createHmac('sha256', SECRET);
hmac.update(signedPayload);
const signature = hmac.digest('hex');
const sigHeader = `t=${timestamp},v1=${signature}`;

console.log(`Simulating Webhook...`);
console.log(`Target: http://localhost:${PORT}/billing/webhook`);
console.log(`Secret: ${SECRET.substring(0, 10)}...`);

// Send Request
axios.post(`http://localhost:${PORT}/billing/webhook`, payload, {
    headers: {
        'Stripe-Signature': sigHeader,
        'Content-Type': 'application/json'
    }
})
    .then(res => {
        console.log("✅ Webhook Delivered Successfully:", res.data);
    })
    .catch(err => {
        console.error("❌ Webhook Failed:");
        if (err.response) {
            console.error(`Status: ${err.response.status}`);
            console.error(`Data:`, err.response.data);
        } else {
            console.error(err.message);
        }
    });
