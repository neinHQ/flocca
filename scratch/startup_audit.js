const cp = require('child_process');
const path = require('path');
const fs = require('fs');

const serversDir = path.join(process.cwd(), 'resources/servers');

// All top-level servers
const topLevel = fs.readdirSync(serversDir).filter(d => {
    const full = path.join(serversDir, d);
    return fs.statSync(full).isDirectory() && d !== 'db' && d !== '.DS_Store';
});

// DB sub-servers
const dbDir = path.join(serversDir, 'db');
const dbServers = fs.existsSync(dbDir) ? fs.readdirSync(dbDir).filter(d => {
    const full = path.join(dbDir, d);
    return fs.statSync(full).isDirectory();
}).map(d => `db/${d}`) : [];

const allServers = [...topLevel, ...dbServers];

async function testServer(name) {
    const serverPath = path.join(serversDir, name, 'server.js');
    if (!fs.existsSync(serverPath)) return { name, status: 'SKIP', reason: 'no server.js' };

    return new Promise((resolve) => {
        const proc = cp.spawn('node', [serverPath], {
            env: { ...process.env },
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 5000
        });

        let stderr = '';
        let stdout = '';
        let done = false;

        proc.stderr.on('data', d => { stderr += d.toString(); });
        proc.stdout.on('data', d => { stdout += d.toString(); });

        proc.on('error', (err) => {
            if (!done) { done = true; resolve({ name, status: 'ERROR', reason: err.message }); }
        });

        proc.on('exit', (code) => {
            if (!done) {
                done = true;
                if (code !== 0 && code !== null) {
                    resolve({ name, status: 'CRASH', reason: stderr.split('\n')[0] || `exit code ${code}` });
                }
            }
        });

        // Give it 2 seconds - if it's still running, it started successfully
        setTimeout(() => {
            if (!done) {
                done = true;
                proc.kill();
                resolve({ name, status: 'OK' });
            }
        }, 2000);
    });
}

(async () => {
    console.log(`Testing ${allServers.length} servers for startup crashes...\n`);
    const results = [];
    for (const name of allServers) {
        const result = await testServer(name);
        const icon = result.status === 'OK' ? '✅' : result.status === 'SKIP' ? '⏭️' : '❌';
        console.log(`${icon} ${name}: ${result.status}${result.reason ? ` - ${result.reason}` : ''}`);
        results.push(result);
    }
    
    const crashes = results.filter(r => r.status === 'CRASH' || r.status === 'ERROR');
    console.log(`\n--- SUMMARY ---`);
    console.log(`Total: ${results.length}`);
    console.log(`OK: ${results.filter(r => r.status === 'OK').length}`);
    console.log(`Skipped: ${results.filter(r => r.status === 'SKIP').length}`);
    console.log(`CRASHED: ${crashes.length}`);
    if (crashes.length > 0) {
        console.log('\nFAILED SERVERS:');
        crashes.forEach(c => console.log(`  ❌ ${c.name}: ${c.reason}`));
    }
})();
