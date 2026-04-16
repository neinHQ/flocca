const path = require('path');
const fs = require('fs');
const glob = require('glob');
const cp = require('child_process');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

// Configuration
function createCypressServer() {
    let sessionConfig = {
        projectRoot: process.env.CYPRESS_PROJECT_ROOT,
        execPath: process.env.CYPRESS_EXEC_PATH || 'npx',
        execArgs: process.env.CYPRESS_EXEC_ARGS ? JSON.parse(process.env.CYPRESS_EXEC_ARGS) : ['cypress'],
        browser: process.env.CYPRESS_BROWSER || 'chrome',
        env: process.env.CYPRESS_ENV ? JSON.parse(process.env.CYPRESS_ENV) : {}
    };

    function normalizeError(message, code = 'CYPRESS_ERROR', details = '') {
        return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { message, code, details } }) }] };
    }

    function runCypress(args, cwd) {
        return new Promise((resolve) => {
            const cmd = sessionConfig.execPath;
            const cliArgs = [...(sessionConfig.execArgs || []), ...args];
            const env = { ...process.env, ...sessionConfig.env };

            let stdout = '';
            let stderr = '';

            const child = cp.spawn(cmd, cliArgs, { cwd, env, shell: true });
            child.stdout.on('data', d => stdout += d.toString());
            child.stderr.on('data', d => stderr += d.toString());
            child.on('close', (code) => {
                resolve({ code, stdout, stderr });
            });
        });
    }

    function ensureConfigured() {
        if (!sessionConfig.projectRoot) {
            sessionConfig.projectRoot = process.env.CYPRESS_PROJECT_ROOT;
            sessionConfig.execPath = process.env.CYPRESS_EXEC_PATH || sessionConfig.execPath;
            sessionConfig.browser = process.env.CYPRESS_BROWSER || sessionConfig.browser;
            // env and execArgs are more complex, keep as is unless explicitly set
        }
        return sessionConfig;
    }
    const server = new McpServer({
        name: "cypress-mcp",
        version: "1.1.0"
    });

    // --- Core Tools ---

    server.tool("cypress_health", 
        {}, 
        async () => {
            const conf = ensureConfigured();
            const healthInfo = { ok: true, configured: !!conf.projectRoot };
            if (conf.projectRoot) {
                try {
                    const verify = await runCypress(['verify'], conf.projectRoot);
                    healthInfo.verified = verify.code === 0;
                    if (verify.code !== 0) healthInfo.details = verify.stderr;
                } catch (e) {
                    healthInfo.verified = false;
                    healthInfo.details = e.message;
                }
            }
            return { content: [{ type: 'text', text: JSON.stringify(healthInfo) }] };
        }
    );

    server.tool("cypress_configure",
        {
            project_root: z.string().optional(),
            browser: z.string().optional(),
            exec_path: z.string().optional(),
            env: z.record(z.string(), z.any()).optional()
        },
        async (args) => {
            if (args.project_root) sessionConfig.projectRoot = args.project_root;
            if (args.browser) sessionConfig.browser = args.browser;
            if (args.exec_path) sessionConfig.execPath = args.exec_path;
            if (args.env) sessionConfig.env = args.env;

            const conf = sessionConfig;
            if (conf.projectRoot && !fs.existsSync(conf.projectRoot)) {
                return normalizeError('Project root does not exist', 'INVALID_CONFIG');
            }
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, config: conf }) }] };
        }
    );

    // --- Execution Pillar ---

    server.tool("cypress_list_specs", 
        {}, 
        async () => {
            const conf = ensureConfigured();
            if (!conf.projectRoot) return normalizeError('Configure project_root first');
            const patterns = ['**/*.cy.{js,ts,jsx,tsx}', '**/*.spec.{js,ts,jsx,tsx}'];
            const specs = [];
            for (const pattern of patterns) {
                const found = glob.sync(pattern, { cwd: conf.projectRoot, ignore: 'node_modules/**' });
                specs.push(...found);
            }
            const uniqueSpecs = [...new Set(specs)].sort();
            return { content: [{ type: 'text', text: JSON.stringify({ specs: uniqueSpecs }) }] };
        }
    );

    server.tool("cypress_run_spec",
        {
            spec: z.string(),
            headed: z.boolean().optional(),
            browser: z.string().optional(),
            record: z.boolean().optional()
        },
        async (args) => {
            const conf = ensureConfigured();
            if (!conf.projectRoot) return normalizeError('Configure project_root first');
            const runArgs = ['run', '--spec', args.spec, '--browser', args.browser || conf.browser, '--reporter', 'json'];
            if (args.headed) runArgs.push('--headed');
            if (args.record) runArgs.push('--record');

            const runRes = await runCypress(runArgs, conf.projectRoot);

            let jsonResult = {};
            try {
                const match = runRes.stdout.match(/\{[\s\S]*"stats":[\s\S]*\}/);
                if (match) {
                    jsonResult = JSON.parse(match[0]);
                } else {
                    jsonResult = { rawOutput: runRes.stdout };
                }
            } catch (e) {
                jsonResult = { rawOutput: runRes.stdout, parseError: e.message };
            }

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        status: runRes.code === 0 ? 'passed' : 'failed',
                        exitCode: runRes.code,
                        results: jsonResult,
                        stderr: runRes.stderr
                    })
                }]
            };
        }
    );

    // --- Environment Pillar ---

    server.tool("cypress_list_browsers", 
        {}, 
        async () => {
            const conf = ensureConfigured();
            if (!conf.projectRoot) return normalizeError('Configure project_root first');
            try {
                const res = await runCypress(['info'], conf.projectRoot);
                const browsersMatch = res.stdout.match(/Browsers:[\s\S]*?(?=\n\n|\n[A-Z])/i);
                return { content: [{ type: 'text', text: browsersMatch ? browsersMatch[0] : res.stdout }] };
            } catch (e) {
                return normalizeError(e.message);
            }
        }
    );

    server.tool("cypress_verify", 
        {}, 
        async () => {
            const conf = ensureConfigured();
            if (!conf.projectRoot) return normalizeError('Configure project_root first');
            const res = await runCypress(['verify'], conf.projectRoot);
            return { content: [{ type: 'text', text: res.stdout + res.stderr }] };
        }
    );

    // --- Observability Pillar ---

    server.tool("cypress_get_failed_tests",
        {
            stdout: z.string()
        },
        async (args) => {
            try {
                const match = args.stdout.match(/\{[\s\S]*"stats":[\s\S]*\}/);
                if (!match) return normalizeError('No JSON result found in input');
                const data = JSON.parse(match[0]);
                const failures = (data.failures || []).map(f => ({
                    title: f.fullTitle,
                    error: f.err?.message,
                    stack: f.err?.stack
                }));
                return { content: [{ type: 'text', text: JSON.stringify({ count: failures.length, failures }) }] };
            } catch (e) {
                return normalizeError(e.message);
            }
        }
    );

    server.__test = {
        sessionConfig,
        normalizeError,
        runCypress,
        ensureConfigured,
        setConfig: (next) => { Object.assign(sessionConfig, next); },
        getConfig: () => ({ ...sessionConfig })
    };

    return server;
}

if (require.main === module) {
    const serverInstance = createCypressServer();
    const transport = new StdioServerTransport();
    serverInstance.connect(transport).then(() => {
        console.error('Cypress MCP server running on stdio');
    }).catch((error) => {
        console.error("Server error:", error);
        process.exit(1);
    });
}

module.exports = { createCypressServer };
