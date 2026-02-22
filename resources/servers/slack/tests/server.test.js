const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '../server.js');

describe('Slack MCP Server', () => {
    it('declares VS Code compatible tool names', () => {
        const source = fs.readFileSync(serverPath, 'utf-8');
        const names = [...source.matchAll(/server\.registerTool\(\s*'([^']+)'/g)].map((m) => m[1]);
        expect(names.length).toBeGreaterThan(0);
        expect(names).toContain('slack_health_check');
        expect(names).toContain('slack_send_message');
        for (const name of names) {
            expect(name).toMatch(/^[a-z0-9_-]+$/);
        }
    });
});
