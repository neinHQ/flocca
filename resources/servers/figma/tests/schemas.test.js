const { createFigmaServer } = require('../server');

describe('Figma MCP Schema Validation', () => {
    let server;

    beforeEach(() => {
        server = createFigmaServer();
    });

    const getValidator = (name) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return tool.inputSchema;
    };

    describe('figma_configure', () => {
        it('should require token', () => {
            const schema = getValidator('figma_configure');
            expect(schema.safeParse({ token: 'figd_123' }).success).toBe(true);
            expect(schema.safeParse({}).success).toBe(false);
        });
    });

    describe('figma_find_frames', () => {
        it('should require query and handle optional file_key', () => {
            const schema = getValidator('figma_find_frames');
            expect(schema.safeParse({ query: 'Login' }).success).toBe(true);
            expect(schema.safeParse({ query: 'Login', file_key: 'abc' }).success).toBe(true);
            expect(schema.safeParse({}).success).toBe(false);
        });
    });

    describe('figma_export_frame_image', () => {
        it('should validate format enum', () => {
            const schema = getValidator('figma_export_frame_image');
            expect(schema.safeParse({ node_id: '1:1', format: 'png' }).success).toBe(true);
            expect(schema.safeParse({ node_id: '1:1', format: 'gif' }).success).toBe(false);
        });
    });
});
