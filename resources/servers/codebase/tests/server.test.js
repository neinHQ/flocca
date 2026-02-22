const assert = require('assert');
const sinon = require('sinon');
const fs = require('fs');
const child_process = require('child_process');
const server = require('../server');

describe('Codebase MCP Server', () => {
    let sendSpy;
    let fsReadFileStub;
    let fsReaddirStub;
    let fsWriteFileStub;
    let execStub;

    beforeEach(() => {
        sendSpy = sinon.spy();
        server.setSendCallback(sendSpy);

        // Mock FS
        fsReadFileStub = sinon.stub(fs, 'readFileSync');
        fsReaddirStub = sinon.stub(fs, 'readdirSync');
        fsWriteFileStub = sinon.stub(fs, 'writeFileSync');
        sinon.stub(fs, 'existsSync').returns(true);
        sinon.stub(fs, 'mkdirSync');

        // Mock Child Process
        execStub = sinon.stub(child_process, 'exec');
    });

    afterEach(() => {
        sinon.restore();
    });

    it('should initialize correctly', async () => {
        await server.handleRequest({ method: 'initialize', id: 1 });
        assert.ok(sendSpy.calledOnce);
        const response = sendSpy.firstCall.args[0];
        assert.strictEqual(response.result.serverInfo.name, 'codebase-mcp');
    });

    it('should list VS Code compatible tool names', async () => {
        await server.handleRequest({ method: 'tools/list', id: 2 });
        assert.ok(sendSpy.calledOnce);
        const response = sendSpy.firstCall.args[0];
        const tools = response.result.tools.map(t => t.name);
        assert.ok(tools.includes('code_read_file'));
        assert.ok(tools.includes('code_list_files'));
        assert.ok(tools.includes('code_write_file'));
        assert.ok(tools.includes('git_push'));
        tools.forEach((toolName) => {
            assert.ok(/^[a-z0-9_-]+$/.test(toolName), `invalid tool name: ${toolName}`);
        });
    });

    it('should read file content via code_read_file', async () => {
        fsReadFileStub.returns('mock content');
        await server.handleRequest({
            method: 'tools/call',
            id: 3,
            params: { name: 'code_read_file', arguments: { path: '/tmp/test.txt' } }
        });

        assert.ok(sendSpy.calledOnce);
        const response = sendSpy.firstCall.args[0];
        assert.strictEqual(response.result.content[0].text, 'mock content');
    });

    it('should execute git command via git_checkout', async () => {
        execStub.yields(null, 'Switched to branch feature', ''); // Success

        await server.handleRequest({
            method: 'tools/call',
            id: 4,
            params: { name: 'git_checkout', arguments: { branch: 'feature', create: true } }
        });

        assert.ok(sendSpy.calledOnce);
        const response = sendSpy.firstCall.args[0];
        assert.ok(response.result.content[0].text.includes('Switched'));
        assert.ok(execStub.calledWithMatch('git checkout -b feature'));
    });
});
