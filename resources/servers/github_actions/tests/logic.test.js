// server requirement moved down to after env setup
const { createGitHubActionsServer } = require('../server'); 

// Mocking Octokit
const mockGetRepo = jest.fn();
const mockListWorkflows = jest.fn();
const mockDispatch = jest.fn();

jest.mock('@octokit/rest', () => {
    return {
        Octokit: jest.fn().mockImplementation(() => ({
            repos: { get: mockGetRepo },
            actions: {
                listRepoWorkflows: mockListWorkflows,
                createWorkflowDispatch: mockDispatch
            }
        }))
    };
});

describe('GitHub Actions MCP Logic', () => {
    let server;

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        process.env.GITHUB_TOKEN = 'test-token';
        process.env.GITHUB_OWNER = 'owner';
        process.env.GITHUB_REPO = 'repo';
        const { createGitHubActionsServer } = require('../server');
        server = createGitHubActionsServer();
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

    describe('Safety Gates', () => {
        it('github_actions_dispatch_workflow requires confirm: true', async () => {
            const res = await callTool('github_actions_dispatch_workflow', { workflow_id: 'w1', ref: 'main', confirm: false });
            expect(res.isError).toBe(true);
            expect(res.content[0].text).toContain('CONFIRMATION_REQUIRED');
            expect(mockDispatch).not.toHaveBeenCalled();
        });

        it('github_actions_dispatch_workflow proceeds with confirm: true', async () => {
            mockDispatch.mockResolvedValue({ status: 204 });
            const res = await callTool('github_actions_dispatch_workflow', { workflow_id: 'w1', ref: 'main', confirm: true });
            expect(res.isError).toBeUndefined();
            expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({
                workflow_id: 'w1',
                ref: 'main'
            }));
        });
    });

    describe('github_actions_list_workflows', () => {
        it('should return mocked workflows', async () => {
            mockListWorkflows.mockResolvedValue({
                data: { workflows: [{ id: 1, name: 'Build' }] }
            });

            const result = await callTool('github_actions_list_workflows');
            const data = JSON.parse(result.content[0].text);

            expect(data).toHaveLength(1);
            expect(data[0].name).toBe('Build');
        });
    });
});
