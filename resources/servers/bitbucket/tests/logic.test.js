const { createBitbucketServer, config } = require('../server');
const axios = require('axios');

jest.mock('axios');

describe('Bitbucket MCP Logic Tests', () => {
    let server;
    let mockAxios;

    beforeEach(() => {
        jest.clearAllMocks();
        server = createBitbucketServer();
        mockAxios = {
            get: jest.fn(),
            post: jest.fn(),
            put: jest.fn(),
            delete: jest.fn()
        };
        axios.create.mockReturnValue(mockAxios);
        
        // Setup default config
        config.username = 'testuser';
        config.password = 'testpass';
        config.workspace = 'testws';
        config.serviceUrl = 'https://api.bitbucket.org/2.0';
    });

    const callTool = async (name, args = {}) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return await tool.handler(args);
    };

    describe('bitbucket_list_repositories', () => {
        it('should fetch repositories for a workspace', async () => {
            mockAxios.get.mockResolvedValue({
                data: { values: [{ name: 'repo1', slug: 'repo-1' }] }
            });

            const res = await callTool('bitbucket_list_repositories', { workspace: 'my-ws' });
            const data = JSON.parse(res.content[0].text);
            
            expect(data[0].name).toBe('repo1');
            expect(mockAxios.get).toHaveBeenCalledWith('/repositories/my-ws', expect.any(Object));
        });
    });

    describe('bitbucket_add_pull_request_comment', () => {
        it('should post a comment to Bitbucket Cloud', async () => {
            mockAxios.post.mockResolvedValue({ data: { id: 123 } });

            const res = await callTool('bitbucket_add_pull_request_comment', {
                repo_slug: 'my-repo',
                pull_request_id: 456,
                text: 'LGTM!'
            });

            expect(res.content[0].text).toContain('Comment added. ID: 123');
            expect(mockAxios.post).toHaveBeenCalledWith(
                '/repositories/testws/my-repo/pullrequests/456/comments',
                { content: { raw: 'LGTM!' } }
            );
        });

        it('should use Server API format when not on Cloud', async () => {
            config.serviceUrl = 'https://bitbucket.mycompany.com/rest/api/1.0';
            mockAxios.post.mockResolvedValue({ data: { id: 789 } });

            await callTool('bitbucket_add_pull_request_comment', {
                workspace: 'PROJ',
                repo_slug: 'repo-s',
                pull_request_id: 1,
                text: 'Server side comment'
            });

            expect(mockAxios.post).toHaveBeenCalledWith(
                '/projects/PROJ/repos/repo-s/pull-requests/1/comments',
                { text: 'Server side comment' }
            );
        });
    });

    describe('bitbucket_get_pipeline_logs', () => {
        it('should return step list if step_uuid is missing', async () => {
            mockAxios.get.mockResolvedValue({
                data: { values: [{ uuid: 'step-1' }] }
            });

            const res = await callTool('bitbucket_get_pipeline_logs', {
                repo_slug: 'repo',
                pipeline_uuid: 'pipe-uuid'
            });

            const data = JSON.parse(res.content[0].text);
            expect(data.steps).toHaveLength(1);
            expect(mockAxios.get).toHaveBeenCalledWith(expect.stringContaining('steps'));
        });
    });
});
