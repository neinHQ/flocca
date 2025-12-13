const axios = require('axios');

const BASE_URL = 'http://localhost:3000';
const USER_A_ID = 'test-user-a-' + Date.now();
const USER_B_ID = 'test-user-b-' + Date.now();

async function runTest() {
    try {
        console.log('--- Starting Teams Verification ---');

        // 1. User A creates a Team
        console.log(`\n1. Creating Team as User A (${USER_A_ID})...`);
        const teamRes = await axios.post(`${BASE_URL}/teams`, { name: 'Engineering' }, {
            headers: { 'x-flocca-user-id': USER_A_ID }
        });
        const teamId = teamRes.data.id;
        console.log(`Team Created: ${teamRes.data.name} (ID: ${teamId})`);

        // 2. User A generates an Invite Code
        console.log('\n2. Generating Invite Code...');
        const inviteRes = await axios.post(`${BASE_URL}/teams/invite`, { teamId }, {
            headers: { 'x-flocca-user-id': USER_A_ID }
        });
        const code = inviteRes.data.code;
        console.log(`Invite Code: ${code}`);

        // 3. User B joins using the Code
        console.log(`\n3. User B (${USER_B_ID}) joining via code...`);
        const joinRes = await axios.post(`${BASE_URL}/teams/join`, { code }, {
            headers: { 'x-flocca-user-id': USER_B_ID }
        });
        console.log('Join Result:', joinRes.data);

        // 4. Verify Membership
        console.log('\n4. Verifying Members List...');
        const membersRes = await axios.get(`${BASE_URL}/teams/${teamId}/members`, {
            headers: { 'x-flocca-user-id': USER_A_ID }
        });
        console.log(`Member Count: ${membersRes.data.length}`);
        if (membersRes.data.length !== 2) throw new Error('Expected 2 members');

        // 5. User A creates a Shared Connection (mocking the Vault behavior)
        console.log('\n5. Creating Shared Connection...');
        // We need to bypass encryption/forms for this test, or hit the endpoint assuming it accepts JSON?
        // Wait, /connect/:provider endpoint expects form data or JSON? Let's check. 
        // It uses body-parser, so JSON works if we construct it right, but `connect.js` does logical checks.
        // Actually, let's inject directly into DB via a quick script or just assume fetching works if we mock the connection creation?
        // Alternatively, let's TRY hitting the endpoint. It expects `req.body.data` etc.
        // Let's cheat and use a separate script to insert into DB? No, let's use the API if possible.
        // `connect.js` uses `req.body` directly.
        await axios.post(`${BASE_URL}/connect/jira`, {
            email: 'admin@flocca.app', token: '123', url: 'https://jira.com',
            teamId: teamId,
            state: USER_A_ID // Required by connect.js
        }, {
            headers: { 'x-flocca-user-id': USER_A_ID }
        });
        // Note: The /connect/jira route does validation? 
        // Looking at `connect.js`, `router.post('/:provider')` does extensive HTML rendering if GET, but POST handles the save.
        // Actually, the route is `router.post('/:provider', ...)` handles the form submission.

        // 6. User B checks connections
        console.log('\n6. User B checking shared connections...');
        const statusRes = await axios.get(`${BASE_URL}/connections`, {
            headers: { 'x-flocca-user-id': USER_B_ID }
        });
        console.log('User B Connections:', statusRes.data);

        if (statusRes.data['jira'] && statusRes.data['jira'].shared) {
            console.log('✅ SUCCESS: User B sees the shared Jira connection!');
        } else {
            console.log('❌ FAIL: User B does NOT see the shared connection.');
        }

    } catch (e) {
        console.error('Test Failed:', e.response?.data || e.message);
    }
}

runTest();
