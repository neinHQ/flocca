const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const SERVER_INFO = { name: 'playwright-mcp', version: '2.0.0' };

function normalizeError(err) {
    const msg = err.message || JSON.stringify(err);
    return { isError: true, content: [{ type: 'text', text: `Playwright Error: ${msg}` }] };
}

function createPlaywrightServer() {
    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });

    async function runPlaywrightCmd(args) {
        return new Promise((resolve) => {
            const child = spawn('npx', ['playwright', ...args], {
                shell: true,
                env: process.env
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data) => stdout += data.toString());
            child.stderr.on('data', (data) => stderr += data.toString());

            child.on('close', (code) => {
                resolve({
                    stdout,
                    stderr,
                    code,
                    success: code === 0
                });
            });
        });
    }

    server.tool('playwright_health', {}, async () => {
        try {
            const result = await runPlaywrightCmd(['--version']);
            if (!result.success) return normalizeError(new Error(result.stderr || 'Playwright not found'));
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, version: result.stdout.trim() }) }] };
        } catch (e) { return normalizeError(e); }
    });

    server.tool('playwright_run_all',
        {
            project: z.string().optional().describe('Filter by Playwright project (e.g. chromium)'),
            grep: z.string().optional().describe('Filter tests by title regular expression')
        },
        async (args) => {
            try {
                const cmdArgs = ['test'];
                if (args.project) cmdArgs.push('--project', args.project);
                if (args.grep) cmdArgs.push('--grep', args.grep);

                const result = await runPlaywrightCmd(cmdArgs);
                const output = result.stdout + (result.stderr ? '\nStderr:\n' + result.stderr : '');
                return {
                    content: [{ type: 'text', text: output }],
                    isError: !result.success
                };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('playwright_list_tests', {}, async () => {
        try {
            const result = await runPlaywrightCmd(['test', '--list']);
            if (!result.success) return normalizeError(new Error(result.stderr));
            return { content: [{ type: 'text', text: result.stdout }] };
        } catch (e) { return normalizeError(e); }
    });

    server.tool('playwright_run_spec',
        {
            spec_path: z.string().describe('Path to the test file to run'),
            project: z.string().optional().describe('Filter by Playwright project')
        },
        async (args) => {
            try {
                const cmdArgs = ['test', args.spec_path];
                if (args.project) cmdArgs.push('--project', args.project);

                const result = await runPlaywrightCmd(cmdArgs);
                const output = result.stdout + (result.stderr ? '\nStderr:\n' + result.stderr : '');
                return {
                    content: [{ type: 'text', text: output }],
                    isError: !result.success
                };
            } catch (e) { return normalizeError(e); }
        }
    );

    return server;
}

if (require.main === module) {
    const server = createPlaywrightServer();
    const transport = new StdioServerTransport();
    server.connect(transport).then(() => {
        console.error('Playwright MCP server running on stdio');
    }).catch((error) => {
        console.error('Server error:', error);
        process.exit(1);
    });
}

module.exports = { createPlaywrightServer };
