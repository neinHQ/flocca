// server requirement moved down to after env setup
const { createFigmaServer } = require('../server'); // Dummy require for linting, will be re-required in tests

// Mock global fetch
global.fetch = jest.fn();

describe('Figma MCP Logic', () => {
    let server;

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        process.env.FIGMA_TOKEN = 'test-token';
        const { createFigmaServer } = require('../server');
        server = createFigmaServer();
    });

    const callTool = async (name, args = {}) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        const result = await tool.handler(args);
        if (result.isError) {
            console.error(`Tool ${name} failed:`, result.content[0].text);
        }
        return result;
    };

    describe('figma_health', () => {
        it('should call figma /me endpoint', async () => {
            fetch.mockResolvedValue({
                ok: true,
                json: async () => ({ user: { handle: 'testuser' } })
            });

            const result = await callTool('figma_health');
            const data = JSON.parse(result.content[0].text);

            expect(data.ok).toBe(true);
            expect(data.user.handle).toBe('testuser');
            expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/v1/me'), expect.any(Object));
        });
    });

    describe('figma_find_frames', () => {
        it('should filter frames by query from file content', async () => {
            fetch.mockResolvedValue({
                ok: true,
                json: async () => ({
                    name: 'Test File',
                    document: {
                        children: [
                            {
                                type: 'CANVAS',
                                children: [
                                    { id: '1:1', name: 'Login Frame', type: 'FRAME' },
                                    { id: '1:2', name: 'Button', type: 'RECTANGLE' }
                                ]
                            }
                        ]
                    }
                })
            });

            const result = await callTool('figma_find_frames', { file_key: 'abc', query: 'login' });
            const data = JSON.parse(result.content[0].text);

            expect(data.frames).toHaveLength(1);
            expect(data.frames[0].name).toBe('Login Frame');
        });
    });

    describe('figma_get_frame_spec', () => {
        it('should extract speculation from node data', async () => {
            fetch.mockResolvedValue({
                ok: true,
                json: async () => ({
                    nodes: {
                        '1:1': {
                            document: {
                                id: '1:1',
                                name: 'Login',
                                type: 'FRAME',
                                children: [
                                    { id: '1:2', name: 'Email Input', type: 'INSTANCE' },
                                    { id: '1:3', name: 'Submit Button', type: 'INSTANCE' }
                                ]
                            }
                        }
                    }
                })
            });

            const result = await callTool('figma_get_frame_spec', { file_key: 'abc', node_id: '1:1' });
            const data = JSON.parse(result.content[0].text);

            expect(data.frame.inputs).toHaveLength(1);
            expect(data.frame.buttons).toHaveLength(1);
        });
    });
});
