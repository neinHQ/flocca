const fs = require('fs');
const path = require('path');
const child_process = require('child_process');
const readline = require('readline');

// Allow dependency injection for testing
let sendCallback = (response) => {
    process.stdout.write(JSON.stringify(response) + "\n");
};

function setSendCallback(cb) {
    sendCallback = cb;
}

function send(response) {
    if (sendCallback) sendCallback(response);
}

// Minimal manual JSON-RPC server loop
if (require.main === module) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false
    });

    rl.on('line', (line) => {
        try {
            const request = JSON.parse(line);
            handleRequest(request);
        } catch (e) { }
    });
}

function runGit(command, cwd) {
    return new Promise((resolve, reject) => {
        child_process.exec(`git ${command}`, { cwd: cwd || process.cwd() }, (err, stdout, stderr) => {
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
                        name: "code.readFile",
                        description: "Read file content",
                        inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }
                    },
                    {
                        name: "code.listFiles",
                        description: "List files in directory",
                        inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }
                    },
                    {
                        name: "code.writeFile",
                        description: "Write content to file (Patch Applier)",
                        inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] }
                    },
                    {
                        name: "git.checkout",
                        description: "Checkout branch",
                        inputSchema: { type: "object", properties: { branch: { type: "string" }, create: { type: "boolean" } }, required: ["branch"] }
                    },
                    {
                        name: "git.commit",
                        description: "Commit changes",
                        inputSchema: { type: "object", properties: { message: { type: "string" } }, required: ["message"] }
                    },
                    {
                        name: "git.push",
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

            if (name === "code.readFile") {
                const content = fs.readFileSync(args.path, 'utf-8');
                resultText = content;
            } else if (name === "code.listFiles") {
                const files = fs.readdirSync(args.path);
                resultText = files.join("\n");
            } else if (name === "code.writeFile") {
                const dir = path.dirname(args.path);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(args.path, args.content);
                resultText = `Wrote to ${args.path}`;
            } else if (name === "git.checkout") {
                const cmd = args.create ? `checkout -b ${args.branch}` : `checkout ${args.branch}`;
                const res = await runGit(cmd);
                resultText = res.output;
                if (!res.success) throw new Error(res.output);
            } else if (name === "git.commit") {
                // Determine what to add. For atomic patch, maybe specific files, but for MVP "git add ."
                await runGit("add .");
                const res = await runGit(`commit - m "${args.message}"`);
                resultText = res.output;
            } else if (name === "git.push") {
                // Assuming upstream is origin
                // Needs branch name, but let's try generic push or current
                const res = await runGit("push");
                // Often needs "set-upstream origin <branch>"
                if (!res.success && res.output.includes("set-upstream")) {
                    // Try to extract branch or just fail gracefully saying "Set upstream manually"
                    // Or try: git push --set-upstream origin HEAD
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

module.exports = {
    handleRequest,
    setSendCallback,
    runGit
};
