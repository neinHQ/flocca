const axios = require('axios');
const prisma = require('../src/db') || new (require('@prisma/client').PrismaClient)();

const BASE_URL = 'http://localhost:3000';

async function runNegativeTest() {
    try {
        console.log('--- Starting Auth Negative Verification ---');

        // Setup: Create 2 Anonymous Users directly in DB (simpler)
        const freeId = 'anon-free-' + Date.now();
        const paidId = 'anon-paid-' + Date.now();

        await prisma.user.create({ data: { id: freeId, subscriptionStatus: 'free' } });
        await prisma.user.create({ data: { id: paidId, subscriptionStatus: 'pro' } });

        console.log(`Created Users: \n Free: ${freeId} \n Paid: ${paidId}`);

        // Test 1: Free User tries to Register
        console.log('\n1. Testing Free User Registration (Should Fail)...');
        try {
            await axios.post(`${BASE_URL}/auth/register`, {
                email: `free-${Date.now()}@test.com`,
                password: 'pass',
                anonymousId: freeId
            });
            console.log('❌ FAIL: Free User managed to register!');
        } catch (e) {
            if (e.response && e.response.status === 403) {
                console.log('✅ PASS: Free User prevented from registering (403 Forbidden).');
            } else {
                console.log(`❌ FAIL: Unexpected error: ${e.message}`);
            }
        }

        // Test 2: Paid User tries to Register
        console.log('\n2. Testing Paid User Registration (Should Succeed)...');
        try {
            const res = await axios.post(`${BASE_URL}/auth/register`, {
                email: `paid-${Date.now()}@test.com`,
                password: 'pass',
                anonymousId: paidId
            });
            if (res.data.success && res.data.claimed) {
                console.log('✅ PASS: Paid User successfully registered.');
            } else {
                console.log(`❌ FAIL: Response indicated failure: ${JSON.stringify(res.data)}`);
            }
        } catch (e) {
            console.log(`❌ FAIL: Paid User failed to register: ${e.response?.data?.error || e.message}`);
        }

    } catch (e) {
        console.error('Test Setup Failed:', e);
    } finally {
        await prisma.$disconnect();
    }
}

runNegativeTest();
