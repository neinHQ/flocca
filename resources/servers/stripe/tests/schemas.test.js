const { createStripeServer } = require('../server');

describe('Stripe MCP Schema Validation', () => {
    let server;

    beforeEach(() => {
        server = createStripeServer();
    });

    const getValidator = (name) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return tool.inputSchema;
    };

    describe('stripe_list_customers', () => {
        it('should allow optional limit', () => {
            const schema = getValidator('stripe_list_customers');
            expect(schema.safeParse({ limit: 5 }).success).toBe(true);
            expect(schema.safeParse({}).success).toBe(true);
            expect(schema.safeParse({ limit: -1 }).success).toBe(false);
        });
    });

    describe('stripe_get_customer', () => {
        it('should require customer_id', () => {
            const schema = getValidator('stripe_get_customer');
            expect(schema.safeParse({ customer_id: 'cus_123' }).success).toBe(true);
            expect(schema.safeParse({}).success).toBe(false);
        });
    });
});
