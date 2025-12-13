const axios = require('axios');

const BASE_URL = 'http://localhost:3000';
const ANON_ID = 'anon-user-' + Date.now();
const EMAIL = `test-${Date.now()}@flocca.app`;
const PASSWORD = 'securepassword123';

async function runTest() {
    try {
        console.log('--- Starting Auth Verification ---');

        // 1. Simulate Anonymous User usage (e.g. creating a connection)
        // We'll just assume the ID exists by upserting it via the teams/connect API logic or just assume register handles "not found" gracefully?
        // Wait, "auth/register" with anonymousId checks if it exists. If not, it just creates a new one? No, my logic was:
        // if (anonUser) update; else create new. 
        // So for "Claiming" to work, we must first HAVE an anonymous user in the DB.

        console.log(`\n1. Seeding Anonymous User (${ANON_ID})...`);
        // Use a known endpoint that upserts users (like /teams or /connect)
        // Let's create a dummy team to force user creation
        await axios.post(`${BASE_URL}/teams`, { name: 'Seed Team' }, {
            headers: { 'x-flocca-user-id': ANON_ID }
        });
        console.log('Anonymous User Seeded.');

        // 2. Register (Claim Account)
        console.log(`\n2. Registering (Claiming ${ANON_ID})...`);
        const regRes = await axios.post(`${BASE_URL}/auth/register`, {
            email: EMAIL,
            password: PASSWORD,
            anonymousId: ANON_ID
        });
        console.log('Register Result:', regRes.data);

        if (regRes.data.user.id !== ANON_ID) {
            console.error('❌ FAIL: User ID changed! Claiming failed.');
        } else {
            console.log('✅ PASS: User ID preserved.');
        }

        // 3. Login
        console.log(`\n3. Logging in as ${EMAIL}...`);
        const loginRes = await axios.post(`${BASE_URL}/auth/login`, {
            email: EMAIL,
            password: PASSWORD
        });
        console.log('Login Result:', loginRes.data);

        if (loginRes.data.success && loginRes.data.user.id === ANON_ID) {
            console.log('✅ SUCCESS: Login successful and data preserved!');
        } else {
            console.log('❌ FAIL: Login failed or ID mismatch.');
        }

    } catch (e) {
        console.error('Test Failed:', e.response?.data || e.message);
    }
}

runTest();
