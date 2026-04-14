const { createStripeServer } = require('../server');
const axios = require('axios');

jest.mock('axios');

describe('Stripe MCP Logic', () => {
    let server;
    let mockAxios;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.STRIPE_SECRET_KEY = 'sk_test_123';
        
        mockAxios = {
            get: jest.fn(),
            post: jest.fn(),
            request: jest.fn()
        };
        axios.create.mockReturnValue(mockAxios);
        server = createStripeServer();
    });

    const callTool = async (name, args = {}) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return await tool.handler(args);
    };

    describe('stripe_health', () => {
        it('should verify connection', async () => {
            mockAxios.get.mockResolvedValue({ data: { object: 'balance' } });
            const res = await callTool('stripe_health');
            const data = JSON.parse(res.content[0].text);
            expect(data.ok).toBe(true);
            expect(mockAxios.get).toHaveBeenCalledWith('/v1/balance');
        });
    });

    describe('stripe_list_customers', () => {
        it('should return customers data', async () => {
            mockAxios.get.mockResolvedValue({ 
                data: { 
                    object: 'list', 
                    data: [{ id: 'cus_1', object: 'customer', email: 'test@example.com' }] 
                } 
            });
            const res = await callTool('stripe_list_customers', { limit: 1 });
            const data = JSON.parse(res.content[0].text);
            expect(data).toHaveLength(1);
            expect(data[0].id).toBe('cus_1');
        });
    });

    describe('stripe_get_balance', () => {
        it('should return balance object', async () => {
            const balanceData = { object: 'balance', available: [{ amount: 1000, currency: 'usd' }] };
            mockAxios.get.mockResolvedValue({ data: balanceData });
            const res = await callTool('stripe_get_balance');
            const data = JSON.parse(res.content[0].text);
            expect(data.object).toBe('balance');
            expect(data.available[0].amount).toBe(1000);
        });
    });
});
