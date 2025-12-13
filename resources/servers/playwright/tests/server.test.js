const assert = require('assert');
const sinon = require('sinon');
const child_process = require('child_process');
const server = require('../server');

describe('Playwright MCP Server', () => {
    let sendSpy;
    let execStub;

    beforeEach(() => {
        sendSpy = sinon.spy();
        server.setSendCallback(sendSpy);
        execStub = sinon.stub(child_process, 'exec');
    });

    afterEach(() => {
        sinon.restore();
    });

    it('should initialize correctly', async () => {
        server.handleRequest({ method: 'initialize', id: 1 });
        assert.ok(sendSpy.calledOnce);
        const response = sendSpy.firstCall.args[0];
        assert.strictEqual(response.result.serverInfo.name, 'playwright-mcp');
    });

    it('should list tools', async () => {
        server.handleRequest({ method: 'tools/list', id: 2 });
        assert.ok(sendSpy.calledOnce);
        const response = sendSpy.firstCall.args[0];
        assert.ok(response.result.tools[0].name === 'playwright.runAll');
    });

    it('should run playwright tests via playwright.runAll', async () => {
        execStub.yields(null, 'Passed 5 tests', ''); // Simulate success

        server.handleRequest({
            method: 'tools/call',
            id: 3,
            params: { name: 'playwright.runAll' }
        });

        assert.ok(sendSpy.calledOnce);
        const response = sendSpy.firstCall.args[0];
        assert.ok(response.result.content[0].text.includes('Passed 5 tests'));
        assert.ok(execStub.calledWith('npx playwright test'));
    });
});
