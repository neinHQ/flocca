
const request = require('supertest');
const app = require('./server');

describe('Mock Backend API', () => {

    // Clear DB
    beforeEach(async () => {
        await request(app).post('/reset');
    });

    it('GET /subscription/status returns none for new user', async () => {
        const res = await request(app).get('/subscription/status?user_id=msg-test-1');
        expect(res.statusCode).toEqual(200);
        expect(res.body.status).toEqual('none');
    });

    it('Webhook activates subscription', async () => {
        const userId = 'msg-test-2';

        // 1. Check initial
        let res = await request(app).get(`/subscription/status?user_id=${userId}`);
        expect(res.body.status).toEqual('none');

        // 2. Fire Webhook
        res = await request(app).post('/webhook').send({
            type: 'checkout.session.completed',
            data: { object: { client_reference_id: userId } }
        });
        expect(res.statusCode).toEqual(200);

        // 3. Check status again
        res = await request(app).get(`/subscription/status?user_id=${userId}`);
        expect(res.body.status).toEqual('active');
        expect(res.body.plan).toEqual('pro');
    });
});
