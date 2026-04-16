function createCodebaseServer() {
    let sessionConfig = {
        cwd: process.cwd(),
        sendCallback: (response) => {
            process.stdout.write(JSON.stringify(response) + "\n");
        }
    };

    function send(response) {
        if (sessionConfig.sendCallback) sessionConfig.sendCallback(response);
    }

    async function runGit(command, cwd) {
        return new Promise((resolve) => {
            child_process.exec(`git ${command}`, { cwd: cwd || sessionConfig.cwd }, (err, stdout, stderr) => {
                if (err) resolve({ success: false, output: stderr || err.message });
                else resolve({ success: true, output: stdout });
            });
        });
    }

    async function handleRequest(request) {
        if (request.method === 'initialize') {
            send({
                jsonrpc: "2.0",
                id: request.id,
                result: {
                    protocolVersion: "2024-11-05",
                    capabilities: { tools: {} },
                    serverInfo: { name: "codebase-mcp", version: "0.1.0" }
                }
            });
        } else if (request.method === 'tools/list') {
            send({
                jsonrpc: "2.0",
                id: request.id,
                result: {
                    tools: [
                        {
                            name: "code_read_file",
                            description: "Read file content",
                            inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }
                        },
                        {
                            name: "code_list_files",
                            description: "List files in directory",
                            inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }
                        },
                        {
                            name: "code_write_file",
                            description: "Write content to file (Patch Applier)",
                            inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] }
                        },
                        {
                            name: "git_checkout",
                            description: "Checkout branch",
                            inputSchema: { type: "object", properties: { branch: { type: "string" }, create: { type: "boolean" } }, required: ["branch"] }
                        },
                        {
                            name: "git_commit",
                            description: "Commit changes",
                            inputSchema: { type: "object", properties: { message: { type: "string" } }, required: ["message"] }
                        },
                        {
                            name: "git_push",
                            description: "Push changes",
                            inputSchema: { type: "object", properties: {} }
                        }
                    ]
                }
            });
        } else if (request.method === 'tools/call') {
            const { name, arguments: args } = request.params;
            try {
                let resultText = "";

                if (name === "code_read_file") {
                    const fullPath = path.isAbsolute(args.path) ? args.path : path.join(sessionConfig.cwd, args.path);
                    const content = fs.readFileSync(fullPath, 'utf-8');
                    resultText = content;
                } else if (name === "code_list_files") {
                    const fullPath = path.isAbsolute(args.path) ? args.path : path.join(sessionConfig.cwd, args.path);
                    const files = fs.readdirSync(fullPath);
                    resultText = files.join("\n");
                } else if (name === "code_write_file") {
                    const fullPath = path.isAbsolute(args.path) ? args.path : path.join(sessionConfig.cwd, args.path);
                    const dir = path.dirname(fullPath);
                    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                    fs.writeFileSync(fullPath, args.content);
                    resultText = `Wrote to ${args.path}`;
                } else if (name === "git_checkout") {
                    const cmd = args.create ? `checkout -b ${args.branch}` : `checkout ${args.branch}`;
                    const res = await runGit(cmd);
                    resultText = res.output;
                    if (!res.success) throw new Error(res.output);
                } else if (name === "git_commit") {
                    await runGit("add .");
                    const res = await runGit(`commit -m "${args.message}"`);
                    resultText = res.output;
                } else if (name === "git_push") {
                    const res = await runGit("push");
                    if (!res.success && res.output.includes("set-upstream")) {
                        const res2 = await runGit("push --set-upstream origin HEAD");
                        resultText = res2.output;
                    } else {
                        resultText = res.output;
                    }
                }

                send({
                    jsonrpc: "2.0", id: request.id,
                    result: { content: [{ type: "text", text: resultText }] }
                });
            } catch (e) {
                send({
                    jsonrpc: "2.0", id: request.id,
                    result: { isError: true, content: [{ type: "text", text: String(e) }] }
                });
            }
        }
    }

    const instance = {
        handleRequest,
        __test: {
            sessionConfig,
            runGit,
            setConfig: (next) => { Object.assign(sessionConfig, next); },
            getConfig: () => ({ ...sessionConfig })
        }
    };

    return instance;
}

if (require.main === module) {
    const serverInstance = createCodebaseServer();
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false
    });

    rl.on('line', (line) => {
        try {
            const request = JSON.parse(line);
            serverInstance.handleRequest(request);
        } catch (e) { }
    });
}

module.exports = { createCodebaseServer };
