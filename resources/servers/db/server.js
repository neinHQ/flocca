const readline = require('readline');
const path = require('path');
let pg;

try {
    // Attempt to load pg from current working directory (project root)
    pg = require(path.join(process.cwd(), 'node_modules', 'pg'));
} catch (e) {
    // Fallback if that fails, try standard require (if script run from root)
    try {
        pg = require('pg');
    } catch (e2) {
        console.error("PG client not found. Ensure 'pg' is installed in node_modules.");
    }
}

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
});

let client = null;

rl.on('line', (line) => {
    try {
        const request = JSON.parse(line);
        handleRequest(request);
    } catch (e) { }
});

function send(response) {
    process.stdout.write(JSON.stringify(response) + "\n");
}

async function handleRequest(request) {
    if (request.method === 'initialize') {
        send({
            jsonrpc: "2.0",
            id: request.id,
            result: {
                protocolVersion: "2024-11-05",
                capabilities: { tools: {} },
                serverInfo: { name: "postgres-mcp", version: "0.1.0" }
            }
        });
    } else if (request.method === 'tools/list') {
        send({
            jsonrpc: "2.0",
            id: request.id,
            result: {
                tools: [
                    {
                        name: "db_connect",
                        description: "Connect to database",
                        inputSchema: { type: "object", properties: { connectionString: { type: "string" } }, required: ["connectionString"] }
                    },
                    {
                        name: "db_get_schema",
                        description: "Get intropspected schema",
                        inputSchema: { type: "object", properties: {} }
                    },
                    {
                        name: "db_query",
                        description: "Execute SQL query",
                        inputSchema: { type: "object", properties: { text: { type: "string" }, confirm: { type: "boolean" } }, required: ["text"] }
                    }
                ]
            }
        });
    } else if (request.method === 'tools/call') {
        const { name, arguments: args } = request.params;
        try {
            let resultText = "";
            if (name === "db_connect") {
                resultText = "Connected (Mock)";
            } else if (name === "db_get_schema") {
                resultText = "Table: users\n  - id: serial\n  - name: text";
            } else if (name === "db_query") {
                const query = args.text.toUpperCase();
                const isDestructive = /INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE/.test(query);

                if (isDestructive && args.confirm !== true) {
                    // Return a specific structure or error code indicating confirmation needed
                    // Since I can only return TextContent/ImageContent/ResourceContent or error,
                    // I'll return a specially formatted text that the client can parse, OR an error.
                    // An error is cleaner for "Stopping execution".
                    throw new Error("CONFIRMATION_REQUIRED");
                }

                // Mock Execution
                resultText = `Executed: ${args.text}`;
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
