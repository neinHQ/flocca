const { createBitbucketServer } = require('../server');

describe('Bitbucket MCP Schema Tests', () => {
    let server;

    beforeEach(() => {
        server = createBitbucketServer();
    });

    const getValidator = (name) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return tool.inputSchema;
    };

    describe('bitbucket_configure', () => {
        it('should allow optional configuration fields', () => {
            const schema = getValidator('bitbucket_configure');
            expect(schema.safeParse({ workspace: 'my-ws' }).success).toBe(true);
            expect(schema.safeParse({ username: 'u', password: 'p' }).success).toBe(true);
        });
    });

    describe('bitbucket_list_repositories', () => {
        it('should handle pagination defaults', () => {
            const schema = getValidator('bitbucket_list_repositories');
            const result = schema.parse({ workspace: 'ws' });
            expect(result.pagelen).toBe(50);
            expect(result.page).toBe(1);
        });
    });

    describe('bitbucket_add_pull_request_comment', () => {
        it('should require repo_slug, pr_id and text', () => {
            const schema = getValidator('bitbucket_add_pull_request_comment');
            
            expect(schema.safeParse({ 
                repo_slug: 'repo', 
                pull_request_id: 1, 
                text: 'hi' 
            }).success).toBe(true);
            
            // Missing required
            expect(schema.safeParse({ repo_slug: 'repo' }).success).toBe(false);
            expect(schema.safeParse({ repo_slug: 'repo', pull_request_id: 1 }).success).toBe(false);
        });
    });

    describe('bitbucket_get_pipeline_logs', () => {
        it('should require repo_slug and pipeline_uuid', () => {
            const schema = getValidator('bitbucket_get_pipeline_logs');
            expect(schema.safeParse({ 
                repo_slug: 'r', 
                pipeline_uuid: 'u' 
            }).success).toBe(true);
            expect(schema.safeParse({ repo_slug: 'r' }).success).toBe(false);
        });
    });
});
