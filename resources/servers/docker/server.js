const path = require('path');
const { z } = require('zod');
const { spawn } = require('child_process');

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');

const SERVER_INFO = { name: 'docker-mcp', version: '1.1.0' };

function createDockerServer() {
    let sessionConfig = {
        daemon: process.env.DOCKER_HOST
            ? (process.env.DOCKER_HOST.startsWith('tcp://')
                ? { type: 'tcp', host: process.env.DOCKER_HOST.replace('tcp://', '') }
                : { type: 'local_socket', socket_path: process.env.DOCKER_HOST.replace('unix://', '') })
            : { type: 'local_socket', socket_path: '/var/run/docker.sock' }
    };

    function normalizeError(message, code = 'DOCKER_ERROR', details = '') {
        return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { message, code, details } }) }] };
    }

    function mapDockerError(stderr = '') {
        const msg = stderr.trim() || 'Docker command failed';
        if (stderr.includes('permission denied')) {
            return normalizeError('Docker daemon access denied', 'PERMISSION_DENIED', 'Check socket permissions or add user to docker group.');
        }
        if (stderr.includes('Cannot connect to the Docker daemon')) {
            return normalizeError('Cannot connect to Docker daemon', 'DAEMON_UNREACHABLE', 'Verify docker is running and the configured host/socket is reachable.');
        }
        if (stderr.includes('No such container')) {
            return normalizeError('Container not found', 'CONTAINER_NOT_FOUND', 'Verify the container ID or name exists.');
        }
        if (stderr.includes('No such image')) {
            return normalizeError('Image not found', 'IMAGE_MISSING', 'Try pulling the image first using docker_pull_image.');
        }
        return normalizeError(msg);
    }

    function buildDaemonArgs() {
        if (!sessionConfig.daemon) return [];
        if (sessionConfig.daemon.type === 'local_socket') {
            return ['-H', `unix://${sessionConfig.daemon.socket_path}`];
        }
        if (sessionConfig.daemon.type === 'tcp') {
            return ['-H', sessionConfig.daemon.host];
        }
        return [];
    }

    function runDocker(args, { input } = {}) {
        return new Promise((resolve) => {
            const daemonArgs = buildDaemonArgs();
            const fullArgs = [...daemonArgs, ...args];
            const child = spawn('docker', fullArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
            let stdout = '';
            let stderr = '';
            if (input) {
                child.stdin.write(input);
                child.stdin.end();
            }
            child.stdout.on('data', (d) => { stdout += d.toString(); });
            child.stderr.on('data', (d) => { stderr += d.toString(); });
            child.on('close', (code) => resolve({ code, stdout, stderr }));
        });
    }

    async function ensureConnected() {
        if (!sessionConfig.daemon || (!sessionConfig.daemon.socket_path && !sessionConfig.daemon.host)) {
            // Re-read env
            sessionConfig.daemon = process.env.DOCKER_HOST
                ? (process.env.DOCKER_HOST.startsWith('tcp://')
                    ? { type: 'tcp', host: process.env.DOCKER_HOST.replace('tcp://', '') }
                    : { type: 'local_socket', socket_path: process.env.DOCKER_HOST.replace('unix://', '') })
                : { type: 'local_socket', socket_path: '/var/run/docker.sock' };
        }
        const res = await runDocker(['version', '--format', '{{.Server.Version}}']);
        if (res.code !== 0) throw new Error(res.stderr.trim() || 'Docker version check failed');
        return res.stdout.trim();
    }
    const server = new McpServer(SERVER_INFO);

    // --- Core Tools ---

    server.tool('docker_health', {}, async () => {
        try {
            const version = await ensureConnected();
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, serverVersion: version }) }] };
        } catch (err) {
            return normalizeError('Failed to connect to Docker daemon', 'DAEMON_UNREACHABLE', err.message);
        }
    });

    server.tool('docker_configure',
        {
            daemon: z.object({
                type: z.enum(['local_socket', 'tcp']),
                socket_path: z.string().optional(),
                host: z.string().optional()
            }).catchall(z.any()).describe('Docker daemon configuration')
        },
        async (args) => {
            sessionConfig.daemon = args.daemon;
            try {
                const version = await ensureConnected();
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true, serverVersion: version }) }] };
            } catch (err) {
                return normalizeError('Failed to connect to Docker daemon', 'DAEMON_UNREACHABLE', err.message);
            }
        }
    );

    // --- Container Pillar ---

    server.tool('docker_list_containers',
        {
            all: z.boolean().default(true).optional()
        },
        async (args) => {
            const cmd = ['ps', '--format', '{{json .}}'];
            if (args.all) cmd.push('-a');
            const res = await runDocker(cmd);
            if (res.code !== 0) return mapDockerError(res.stderr);
            const containers = res.stdout.trim().split('\n').filter(Boolean).map((line) => {
                try { return JSON.parse(line); } catch (_) { return null; }
            }).filter(Boolean);
            return { content: [{ type: 'text', text: JSON.stringify({ containers }) }] };
        }
    );

    server.tool('docker_run_container',
        {
            image: z.string(),
            name: z.string().optional(),
            env: z.object({}).catchall(z.any()).optional().describe('Environment variables as key-value pairs'),
            command: z.array(z.string()).optional(),
            detach: z.boolean().default(true),
            mounts: z.array(z.object({
                type: z.enum(['bind', 'volume', 'tmpfs']),
                source: z.string(),
                target: z.string()
            }).catchall(z.any())).optional().describe('List of mounts')
        },
        async (args) => {
            const cliArgs = ['run'];
            if (args.detach !== false) cliArgs.push('-d');
            if (args.name) cliArgs.push('--name', args.name);
            if (args.env) {
                Object.entries(args.env).forEach(([k, v]) => cliArgs.push('-e', `${k}=${v}`));
            }
            if (args.mounts) {
                for (const m of args.mounts) {
                    if (typeof m !== 'object' || !m.type || !m.source || !m.target) {
                        return normalizeError('Invalid mount format', 'INVALID_PARAMS');
                    }
                    cliArgs.push('--mount', `type=${m.type},source=${m.source},target=${m.target}`);
                }
            }
            cliArgs.push(args.image);
            if (args.command) cliArgs.push(...args.command);

            const res = await runDocker(cliArgs);
            if (res.code !== 0) {
                if (res.stderr.includes('pull access denied') || res.stderr.includes('not found')) {
                    const pull = await runDocker(['pull', args.image]);
                    if (pull.code !== 0) return mapDockerError(pull.stderr || res.stderr);
                    const retry = await runDocker(cliArgs);
                    if (retry.code !== 0) return mapDockerError(retry.stderr);
                    return { content: [{ type: 'text', text: JSON.stringify({ containerId: retry.stdout.trim() }) }] };
                }
                return mapDockerError(res.stderr);
            }
            return { content: [{ type: 'text', text: JSON.stringify({ containerId: res.stdout.trim() }) }] };
        }
    );

    server.tool('docker_stop_container',
        { 
            container_id: z.string(),
            confirm: z.boolean().optional().describe('Must be true to stop the container')
        },
        async (args) => {
            if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED: Set 'confirm: true' to stop the container." }] };
            const res = await runDocker(['stop', args.container_id]);
            if (res.code !== 0) return mapDockerError(res.stderr);
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, message: res.stdout.trim() }) }] };
        }
    );

    server.tool('docker_remove_container',
        { 
            container_id: z.string(), 
            force: z.boolean().default(false),
            confirm: z.boolean().optional().describe('Must be true to remove the container')
        },
        async (args) => {
            if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED: Set 'confirm: true' to remove the container." }] };
            const cli = ['rm'];
            if (args.force) cli.push('-f');
            cli.push(args.container_id);
            const res = await runDocker(cli);
            if (res.code !== 0) return mapDockerError(res.stderr);
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, message: res.stdout.trim() }) }] };
        }
    );

    server.tool('docker_exec',
        {
            container_id: z.string(),
            command: z.array(z.string())
        },
        async (args) => {
            const cli = ['exec', args.container_id, ...args.command];
            const res = await runDocker(cli);
            if (res.code !== 0) return mapDockerError(res.stderr);
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, exitCode: res.code, output: res.stdout }) }] };
        }
    );

    // --- Image Pillar ---

    server.tool('docker_list_images', {}, async () => {
        const res = await runDocker(['images', '--format', '{{json .}}']);
        if (res.code !== 0) return mapDockerError(res.stderr);
        const images = res.stdout.trim().split('\n').filter(Boolean).map((line) => {
            try { return JSON.parse(line); } catch (_) { return null; }
        }).filter(Boolean);
        return { content: [{ type: 'text', text: JSON.stringify({ images }) }] };
    });

    server.tool('docker_pull_image',
        { image: z.string() },
        async (args) => {
            const res = await runDocker(['pull', args.image]);
            if (res.code !== 0) return mapDockerError(res.stderr);
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, output: res.stdout }) }] };
        }
    );

    server.tool('docker_remove_image',
        {
            image: z.string().describe('Image ID or name to remove'),
            force: z.boolean().default(false),
            confirm: z.boolean().optional().describe('Must be true to remove the image')
        },
        async (args) => {
            if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED: Set 'confirm: true' to remove the image." }] };
            const cli = ['rmi'];
            if (args.force) cli.push('-f');
            cli.push(args.image);
            const res = await runDocker(cli);
            if (res.code !== 0) return mapDockerError(res.stderr);
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, message: res.stdout.trim() }) }] };
        }
    );

    server.tool('docker_build_image',
        {
            context_path: z.string(),
            dockerfile_path: z.string().optional(),
            tags: z.array(z.string()).optional()
        },
        async (args) => {
            const cli = ['build', args.context_path];
            if (args.dockerfile_path) cli.push('-f', args.dockerfile_path);
            if (args.tags) args.tags.forEach((t) => cli.push('-t', t));
            const res = await runDocker(cli);
            if (res.code !== 0) return mapDockerError(res.stderr);
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, output: res.stdout }) }] };
        }
    );

    // --- Observability Pillar ---

    server.tool('docker_container_stats',
        { container_id: z.string().optional() },
        async (args) => {
            const cli = ['stats', '--no-stream', '--format', '{{json .}}'];
            if (args.container_id) cli.push(args.container_id);
            const res = await runDocker(cli);
            if (res.code !== 0) return mapDockerError(res.stderr);
            const stats = res.stdout.trim().split('\n').filter(Boolean).map((line) => {
                try { return JSON.parse(line); } catch (_) { return null; }
            }).filter(Boolean);
            return { content: [{ type: 'text', text: JSON.stringify({ stats }) }] };
        }
    );

    server.tool('docker_get_logs',
        { 
            container_id: z.string(), 
            tail: z.number().optional().describe('Number of lines from the end') 
        },
        async (args) => {
            const cli = ['logs'];
            if (args.tail) cli.push('--tail', String(args.tail));
            cli.push(args.container_id);
            const res = await runDocker(cli);
            if (res.code !== 0) return mapDockerError(res.stderr);
            return { content: [{ type: 'text', text: JSON.stringify({ logs: res.stdout }) }] };
        }
    );

    server.tool('docker_system_info', {}, async () => {
        const res = await runDocker(['info', '--format', '{{json .}}']);
        if (res.code !== 0) return mapDockerError(res.stderr);
        let data;
        try { data = JSON.parse(res.stdout); } catch (_) { data = res.stdout; }
        return { content: [{ type: 'text', text: JSON.stringify({ info: data }) }] };
    });

    // --- Resource Lifecycle (Cleanup) ---

    server.tool('docker_system_prune',
        { 
            all: z.boolean().default(false), 
            volumes: z.boolean().default(false),
            confirm: z.boolean().optional().describe('Must be true to prune system resources')
        },
        async (args) => {
            if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED: Set 'confirm: true' to prune system resources." }] };
            const cli = ['system', 'prune', '-f'];
            if (args.all) cli.push('--all');
            if (args.volumes) cli.push('--volumes');
            const res = await runDocker(cli);
            if (res.code !== 0) return mapDockerError(res.stderr);
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, output: res.stdout.trim() }) }] };
        }
    );

    server.tool('docker_image_prune',
        { 
            all: z.boolean().default(false),
            confirm: z.boolean().optional().describe('Must be true to prune images')
        },
        async (args) => {
            if (!args.confirm) return { isError: true, content: [{ type: 'text', text: "CONFIRMATION_REQUIRED: Set 'confirm: true' to prune images." }] };
            const cli = ['image', 'prune', '-f'];
            if (args.all) cli.push('-a');
            const res = await runDocker(cli);
            if (res.code !== 0) return mapDockerError(res.stderr);
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, output: res.stdout.trim() }) }] };
        }
    );

    // --- Utility Pillar ---

    server.tool('docker_cp',
        {
            source: z.string().describe("Source path (e.g. host_path or container_id:path)"),
            target: z.string().describe("Target path (e.g. container_id:path or host_path)")
        },
        async (args) => {
            const res = await runDocker(['cp', args.source, args.target]);
            if (res.code !== 0) return mapDockerError(res.stderr);
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, message: "File(s) copied successfully" }) }] };
        }
    );

    server.tool('docker_top',
        { container_id: z.string() },
        async (args) => {
            const res = await runDocker(['top', args.container_id, '-aux']);
            if (res.code !== 0) return mapDockerError(res.stderr);
            return { content: [{ type: 'text', text: JSON.stringify({ processes: res.stdout.trim() }) }] };
        }
    );

    // Reuse other existing tools (simplified logic)
    server.tool('docker_list_networks', {}, async () => {
        const res = await runDocker(['network', 'ls', '--format', '{{json .}}']);
        if (res.code !== 0) return mapDockerError(res.stderr);
        const networks = res.stdout.trim().split('\n').filter(Boolean).map((line) => {
            try { return JSON.parse(line); } catch (_) { return null; }
        }).filter(Boolean);
        return { content: [{ type: 'text', text: JSON.stringify({ networks }) }] };
    });

    server.tool('docker_list_volumes', {}, async () => {
        const res = await runDocker(['volume', 'ls', '--format', '{{json .}}']);
        if (res.code !== 0) return mapDockerError(res.stderr);
        const volumes = res.stdout.trim().split('\n').filter(Boolean).map((line) => {
            try { return JSON.parse(line); } catch (_) { return null; }
        }).filter(Boolean);
        return { content: [{ type: 'text', text: JSON.stringify({ volumes }) }] };
    });

    // Final connector
    server.__test = {
        sessionConfig,
        normalizeError,
        mapDockerError,
        runDocker,
        ensureConnected,
        setConfig: (next) => { Object.assign(sessionConfig, next); },
        getConfig: () => ({ ...sessionConfig })
    };

    return server;
}

if (require.main === module) {
    const serverInstance = createDockerServer();
    const transport = new StdioServerTransport();
    serverInstance.connect(transport).then(() => {
        console.error('Docker MCP server running on stdio');
    }).catch((err) => {
        console.error('Docker MCP server failed to start:', err);
        process.exit(1);
    });
}

module.exports = { createDockerServer };
