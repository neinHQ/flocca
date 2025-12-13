#!/usr/bin/env node

// Simpler approach: Manual JSON-RPC
const readline = require('readline');
const child_process = require('child_process');

let sendCallback = (response) => {
    process.stdout.write(JSON.stringify(response) + "\n");
};

function setSendCallback(cb) {
    sendCallback = cb;
}

function send(response) {
    if (sendCallback) sendCallback(response);
}

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
        } catch (e) {
            console.error("Failed to parse JSON", e);
        }
    });
}

function handleRequest(request) {
    if (request.method === 'initialize') {
        send({
            jsonrpc: "2.0",
            id: request.id,
            result: {
                protocolVersion: "2024-11-05",
                capabilities: { tools: {} },
                serverInfo: { name: "playwright-mcp", version: "0.1.0" }
            }
        });
    } else if (request.method === 'tools/list') {
        send({
            jsonrpc: "2.0",
            id: request.id,
            result: {
                tools: [
                    {
                        name: "playwright.runAll",
                        description: "Run all Playwright tests",
                        inputSchema: { type: "object", properties: {} }
                    }
                ]
            }
        });
    } else if (request.method === 'tools/call') {
        const { name } = request.params;
        if (name === "playwright.runAll") {
            child_process.exec("npx playwright test", (error, stdout, stderr) => {
                let output = stdout + "\n" + stderr;
                if (error) {
                    if (stderr.includes('command not found') || error.code === 127) {
                        output = "Playwright or npx not found. Please install Node.js and run `npx playwright install`.\n" + output;
                    }
                }
                send({
                    jsonrpc: "2.0",
                    id: request.id,
                    result: {
                        content: [{
                            type: "text",
                            text: output
                        }]
                    }
                });
            });
        }
    }
}

module.exports = {
    handleRequest,
    setSendCallback
};
