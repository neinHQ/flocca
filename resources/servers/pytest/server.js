const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const { spawn } = require('child_process');

const SERVER_INFO = { name: 'pytest-mcp', version: '2.0.0' };

function normalizeError(err) {
    const msg = err.message || JSON.stringify(err);
    return { isError: true, content: [{ type: 'text', text: `Pytest Error: ${msg}` }] };
}

function createPytestServer() {
    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });

    async function runPytestCmd(args) {
        return new Promise((resolve) => {
            const extraArgs = process.env.PYTEST_ARGS ? process.env.PYTEST_ARGS.split(/\s+/) : [];
            const finalArgs = [...args, ...extraArgs].filter(Boolean);

            const child = spawn('pytest', finalArgs, {
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
                    success: code === 0 || code === 1 // pytest exit code 1 means some tests failed but it ran
                });
            });

            child.on('error', (err) => {
                resolve({
                    stdout,
                    stderr: err.message,
                    code: -1,
                    success: false
                });
            });
        });
    }

    server.tool('pytest_health', {}, async () => {
        try {
            const result = await runPytestCmd(['--version']);
            if (result.code === -1) return normalizeError(new Error(result.stderr || 'pytest not found'));
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, version: result.stdout.trim() || result.stderr.trim() }) }] };
        } catch (e) { return normalizeError(e); }
    });

    server.tool('pytest_run_all',
        {
            directory: z.string().optional().describe('Filter by directory (e.g. tests/unit)'),
            args: z.string().optional().describe('Extra pytest arguments')
        },
        async (args) => {
            try {
                const cmdArgs = [];
                if (args.directory) cmdArgs.push(args.directory);
                if (args.args) cmdArgs.push(...args.args.split(/\s+/));

                const result = await runPytestCmd(cmdArgs);
                const output = result.stdout + (result.stderr ? '\nStderr:\n' + result.stderr : '');
                return {
                    content: [{ type: 'text', text: output }],
                    isError: result.code === -1 // only error if command failed to run
                };
            } catch (e) { return normalizeError(e); }
        }
    );

    server.tool('pytest_run_file',
        {
            path: z.string().describe('Path to the test file to run'),
            args: z.string().optional().describe('Extra pytest arguments')
        },
        async (args) => {
            try {
                const cmdArgs = [args.path];
                if (args.args) cmdArgs.push(...args.args.split(/\s+/));

                const result = await runPytestCmd(cmdArgs);
                const output = result.stdout + (result.stderr ? '\nStderr:\n' + result.stderr : '');
                return {
                    content: [{ type: 'text', text: output }],
                    isError: result.code === -1
                };
            } catch (e) { return normalizeError(e); }
        }
    );

    return server;
}

if (require.main === module) {
    const server = createPytestServer();
    const transport = new StdioServerTransport();
    server.connect(transport).then(() => {
        console.error('Pytest MCP server running on stdio');
    }).catch((error) => {
        console.error('Server error:', error);
        process.exit(1);
    });
}

module.exports = { createPytestServer };
