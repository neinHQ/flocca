const path = require('path');
const fs = require('fs');
const { groupBy } = require('lodash'); // Not using lodash to keep deps minimal unless needed
const glob = require('glob');
const cp = require('child_process');
const readline = require('readline');

// Configuration
const config = {
    projectRoot: process.env.CYPRESS_PROJECT_ROOT,
    execPath: process.env.CYPRESS_EXEC_PATH || 'npx', // default to npx cypress
    execArgs: process.env.CYPRESS_EXEC_ARGS ? JSON.parse(process.env.CYPRESS_EXEC_ARGS) : ['cypress'], // e.g. ['cypress']
    browser: process.env.CYPRESS_BROWSER || 'chrome',
    env: process.env.CYPRESS_ENV ? JSON.parse(process.env.CYPRESS_ENV) : {}
};

// JSON-RPC Helpers
const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");

function normalizeError(message, code = 'CYPRESS_ERROR', details = '') {
    return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { message, code, details } }) }] };
}

// Helpers
function runCypress(args, cwd) {
    return new Promise((resolve) => {
        // Construct command
        const cmd = config.execPath;
        const cliArgs = [...(config.execArgs || []), ...args];

        // Environment
        const env = { ...process.env, ...config.env };

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

// Tool Handlers
async function handleToolCall(name, args) {
    try {
        switch (name) {
            case 'cypress.health':
                // Check if we can run `cypress -v` or verify project root
                const healthInfo = { ok: true, configured: !!config.projectRoot };
                if (config.projectRoot) {
                    try {
                        const verify = await runCypress(['verify'], config.projectRoot);
                        if (verify.code !== 0) healthInfo.details = "Cypress verification failed: " + verify.stderr;
                        healthInfo.verified = verify.code === 0;
                    } catch (e) {
                        healthInfo.verified = false;
                        healthInfo.details = e.message;
                    }
                }
                return { content: [{ type: 'text', text: JSON.stringify(healthInfo) }] };

            case 'cypress.configure':
                if (args.project_root) config.projectRoot = args.project_root;
                if (args.browser) config.browser = args.browser;
                if (args.exec_path) config.execPath = args.exec_path;
                if (args.env) config.env = args.env;

                // Validate
                if (!fs.existsSync(config.projectRoot)) {
                    return normalizeError('Project root does not exist', 'INVALID_CONFIG');
                }
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true, config }) }] };

            case 'cypress.listSpecs':
                if (!config.projectRoot) return normalizeError('Configure project_root first');
                // Look for common patterns
                const patterns = ['**/*.cy.{js,ts,jsx,tsx}', '**/*.spec.{js,ts,jsx,tsx}'];
                const specs = [];
                for (const pattern of patterns) {
                    const found = glob.sync(pattern, { cwd: config.projectRoot, ignore: 'node_modules/**' });
                    specs.push(...found);
                }
                // Unique and sort
                const uniqueSpecs = [...new Set(specs)].sort();
                return { content: [{ type: 'text', text: JSON.stringify({ specs: uniqueSpecs }) }] };

            case 'cypress.runSpec':
                if (!config.projectRoot) return normalizeError('Configure project_root first');
                // Args: spec, headed, browser, record
                const runArgs = ['run', '--spec', args.spec, '--browser', args.browser || config.browser, '--reporter', 'json'];
                if (args.headed) runArgs.push('--headed');
                if (args.record) runArgs.push('--record');

                const runRes = await runCypress(runArgs, config.projectRoot);

                // Parse JSON output from stdout
                // Cypress writes json reporter output to stdout, but might have other logs. 
                // We try to find the JSON block.
                let jsonResult = {};
                try {
                    // Try to extract JSON from stdout
                    // It often comes formatted. We look for a block that looks like { "stats": ... }
                    const match = runRes.stdout.match(/\{[\s\S]*"stats":[\s\S]*\}/);
                    if (match) {
                        jsonResult = JSON.parse(match[0]);
                    } else {
                        // Fallback: try parsing whole stdout if clean
                        jsonResult = JSON.parse(runRes.stdout);
                    }
                } catch (e) {
                    // If parsing failed, return raw output
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

            case 'cypress.runAll':
                // Very similar to runSpec but without specific spec or specific tags
                if (!config.projectRoot) return normalizeError('Configure project_root first');
                const allArgs = ['run', '--browser', args.browser || config.browser, '--reporter', 'json'];
                if (args.tags && Array.isArray(args.tags)) {
                    // Requires cypress-grep or similar usually, or just env vars. 
                    // Assuming standard config or env setup for tags if user asks.
                    // For now, let's pass env vars for tags if typical plugin used
                    config.env['grepTags'] = args.tags.join(' ');
                }

                const allRes = await runCypress(allArgs, config.projectRoot);
                let allJson = {};
                try {
                    const m = allRes.stdout.match(/\{[\s\S]*"stats":[\s\S]*\}/);
                    if (m) allJson = JSON.parse(m[0]);
                } catch (e) { allJson = { rawOutput: allRes.stdout }; }

                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            status: allRes.code === 0 ? 'passed' : 'failed',
                            results: allJson
                        })
                    }]
                };

            case 'cypress.getVideo':
                // Find video for spec
                // Default video folder: cypress/videos
                if (!config.projectRoot) return normalizeError('Configure project_root first');
                // Spec path relative to root
                const specName = path.basename(args.spec);
                // Look for video file matching spec name
                const videos = glob.sync(`**/${specName}.mp4`, { cwd: path.join(config.projectRoot, 'cypress', 'videos') });
                if (videos.length > 0) {
                    const fullPath = path.join(config.projectRoot, 'cypress', 'videos', videos[0]);
                    return { content: [{ type: 'text', text: fullPath }] };
                }
                return { content: [{ type: 'text', text: null }] };

            case 'cypress.getScreenshot':
                if (!config.projectRoot) return normalizeError('Configure project_root first');
                // Screenshots usually in cypress/screenshots/<spec>/<test>.png
                const shotPattern = `**/*${args.test_title.replace(/[^a-z0-9]/gi, '*')}.png`;
                const shots = glob.sync(shotPattern, { cwd: path.join(config.projectRoot, 'cypress', 'screenshots') });
                if (shots.length > 0) {
                    const fullPath = path.join(config.projectRoot, 'cypress', 'screenshots', shots[0]);
                    return { content: [{ type: 'text', text: fullPath }] };
                }
                return { content: [{ type: 'text', text: null }] };

            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    } catch (e) {
        return normalizeError(e.message, 'INTERNAL_ERROR');
    }
}

// Stdio Handler
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

rl.on('line', (line) => {
    try {
        const req = JSON.parse(line);
        if (req.method === 'initialize') {
            send({
                jsonrpc: "2.0", id: req.id,
                result: {
                    protocolVersion: "2024-11-05",
                    capabilities: { tools: {} },
                    serverInfo: { name: "cypress-mcp", version: "1.0.0" }
                }
            });
        } else if (req.method === 'tools/list') {
            send({
                jsonrpc: "2.0", id: req.id,
                result: {
                    tools: [
                        { name: "cypress.health", description: "Check availability", inputSchema: { type: "object", properties: {} } },
                        {
                            name: "cypress.configure",
                            description: "Configure Cypress Session",
                            inputSchema: {
                                type: "object",
                                properties: {
                                    project_root: { type: "string" },
                                    browser: { type: "string" },
                                    exec_path: { type: "string" },
                                    env: { type: "object" }
                                }
                            }
                        },
                        { name: "cypress.listSpecs", description: "List spec files", inputSchema: { type: "object", properties: {} } },
                        {
                            name: "cypress.runSpec",
                            description: "Run a single spec",
                            inputSchema: {
                                type: "object",
                                properties: {
                                    spec: { type: "string" },
                                    headed: { type: "boolean" },
                                    browser: { type: "string" },
                                    record: { type: "boolean" }
                                },
                                required: ["spec"]
                            }
                        },
                        {
                            name: "cypress.runAll",
                            description: "Run all specs",
                            inputSchema: {
                                type: "object",
                                properties: {
                                    browser: { type: "string" },
                                    tags: { type: "array", items: { type: "string" } }
                                }
                            }
                        },
                        {
                            name: "cypress.getVideo",
                            description: "Get video artifact path",
                            inputSchema: { type: "object", properties: { spec: { type: "string" } }, required: ["spec"] }
                        },
                        {
                            name: "cypress.getScreenshot",
                            description: "Get screenshot artifact path",
                            inputSchema: { type: "object", properties: { spec: { type: "string" }, test_title: { type: "string" } }, required: ["spec", "test_title"] }
                        }
                    ]
                }
            });
        } else if (req.method === 'tools/call') {
            handleToolCall(req.params.name, req.params.arguments || {}).then(res => {
                send({ jsonrpc: "2.0", id: req.id, result: res });
            });
        }
    } catch (e) {
        // ignore
    }
});
