// server requirement moved down to after mock
const { createGitHubServer } = require('../server'); 

// Mocking Octokit
const mockRateLimit = jest.fn();
const mockSearchRepos = jest.fn();
const mockCreateIssue = jest.fn();
const mockMergePR = jest.fn();

jest.mock('@octokit/rest', () => {
    return {
        Octokit: jest.fn().mockImplementation(() => ({
            rest: {
                rateLimit: { get: mockRateLimit },
                search: { repos: mockSearchRepos },
                issues: { create: mockCreateIssue },
                pulls: { merge: mockMergePR }
            }
        }))
    };
});

// Mocking child_process
const mockExec = jest.fn();
jest.mock('child_process', () => ({
    exec: (cmd, cb) => mockExec(cmd, cb)
}));

describe('GitHub MCP Logic', () => {
    let server;

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        process.env.GITHUB_TOKEN = 'test-token';
        const { createGitHubServer } = require('../server');
        server = createGitHubServer();
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
        it('create_issue requires confirm: true', async () => {
            const res = await callTool('create_issue', { owner: 'o1', repo: 'r1', title: 't1', confirm: false });
            expect(res.isError).toBe(true);
            expect(res.content[0].text).toContain('CONFIRMATION_REQUIRED');
            expect(mockCreateIssue).not.toHaveBeenCalled();
        });

        it('git_commit requires confirm: true', async () => {
            const res = await callTool('git_commit', { message: 'm1', confirm: false });
            expect(res.isError).toBe(true);
            expect(res.content[0].text).toContain('CONFIRMATION_REQUIRED');
        });

        it('merge_pull_request requires confirm: true', async () => {
            const res = await callTool('merge_pull_request', { owner: 'o1', repo: 'r1', pull_number: 1, confirm: false });
            expect(res.isError).toBe(true);
            expect(res.content[0].text).toContain('CONFIRMATION_REQUIRED');
            expect(mockMergePR).not.toHaveBeenCalled();
        });
    });

    describe('github_health', () => {
        it('should check rate limits', async () => {
            mockRateLimit.mockResolvedValue({ data: { resources: {} } });
            const result = await callTool('github_health');
            const data = JSON.parse(result.content[0].text);
            expect(data.ok).toBe(true);
            expect(mockRateLimit).toHaveBeenCalled();
        });
    });

    describe('git_add', () => {
        it('should call git add CLI', async () => {
            mockExec.mockImplementation((cmd, cb) => cb(null, { stdout: '', stderr: '' }));
            const result = await callTool('git_add', { files: ['file1.js'] });
            expect(result.content[0].text).toContain('Successfully staged: file1.js');
            expect(mockExec).toHaveBeenCalledWith(expect.stringContaining('git add file1.js'), expect.any(Function));
        });
    });
});
