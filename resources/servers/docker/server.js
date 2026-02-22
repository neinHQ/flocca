const path = require('path');
const z = require('zod');
const { spawn } = require('child_process');

const { McpServer } = require(path.join(__dirname, '../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.js'));
const { StdioServerTransport } = require(path.join(__dirname, '../../../node_modules/@modelcontextprotocol/sdk/dist/cjs/server/stdio.js'));

const SERVER_INFO = { name: 'docker-mcp', version: '0.1.0' };

const sessionConfig = {
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
        const fullArgs = [...buildDaemonArgs(), ...args];
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

async function validateDocker() {
    const res = await runDocker(['version', '--format', '{{.Server.Version}}']);
    if (res.code !== 0) throw new Error(res.stderr.trim() || 'Docker version check failed');
    return res.stdout.trim();
}

async function main() {
    // Best-effort startup validation with defaults; failures are logged but do not crash
    try {
        const version = await validateDocker();
        console.log(`Docker reachable. Server version: ${version}`);
    } catch (e) {
        console.warn('Docker validation on startup failed:', e.message);
    }

    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });
    const originalRegisterTool = server.registerTool.bind(server);
    const permissiveInputSchema = z.object({}).passthrough();
    server.registerTool = (name, config, handler) => {
        const nextConfig = { ...(config || {}) };
        if (!nextConfig.inputSchema || typeof nextConfig.inputSchema.safeParseAsync !== 'function') {
            nextConfig.inputSchema = permissiveInputSchema;
        }
        return originalRegisterTool(name, nextConfig, handler);
    };

    server.registerTool(
        'docker_health',
        { description: 'Health check for Docker MCP server.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
        async () => ({ content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] })
    );

    server.registerTool(
        'docker_configure',
        {
            description: 'Configure Docker daemon connectivity.',
            inputSchema: {
                type: 'object',
                properties: {
                    daemon: {
                        type: 'object',
                        properties: {
                            type: { type: 'string', enum: ['local_socket', 'tcp'] },
                            socket_path: { type: 'string' },
                            host: { type: 'string' }
                        },
                        required: ['type']
                    }
                },
                required: ['daemon'],
                additionalProperties: false
            }
        },
        async (args) => {
            sessionConfig.daemon = args.daemon;
            try {
                const version = await validateDocker();
                return { content: [{ type: 'text', text: JSON.stringify({ ok: true, serverVersion: version }) }] };
            } catch (err) {
                sessionConfig.daemon = undefined;
                return normalizeError('Failed to connect to Docker daemon', 'DAEMON_UNREACHABLE', err.message);
            }
        }
    );

    server.registerTool(
        'docker_list_containers',
        {
            description: 'List running and stopped containers.',
            inputSchema: { type: 'object', properties: {}, additionalProperties: false }
        },
        async () => {
            const res = await runDocker(['ps', '-a', '--format', '{{json .}}']);
            if (res.code !== 0) return mapDockerError(res.stderr);
            const containers = res.stdout.trim().split('\n').filter(Boolean).map((line) => {
                try { return JSON.parse(line); } catch (_) { return null; }
            }).filter(Boolean);
            return { content: [{ type: 'text', text: JSON.stringify({ containers }) }] };
        }
    );

    server.registerTool(
        'docker_run_container',
        {
            description: 'Run a container with given parameters.',
            inputSchema: {
                type: 'object',
                properties: {
                    image: { type: 'string' },
                    name: { type: 'string' },
                    env: { type: 'object' },
                    command: { type: 'array', items: { type: 'string' } },
                    detach: { type: 'boolean', default: true },
                    mounts: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                type: { type: 'string', enum: ['bind', 'volume'] },
                                source: { type: 'string' },
                                target: { type: 'string' }
                            },
                            required: ['type', 'source', 'target']
                        }
                    }
                },
                required: ['image'],
                additionalProperties: false
            }
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
                    // basic unsafe mount check
                    if (m.type === 'bind' && m.source.startsWith('/')) {
                        cliArgs.push('--mount', `type=${m.type},source=${m.source},target=${m.target}`);
                    } else if (m.type === 'volume') {
                        cliArgs.push('--mount', `type=volume,source=${m.source},target=${m.target}`);
                    }
                }
            }
            cliArgs.push(args.image);
            if (args.command) cliArgs.push(...args.command);

            const res = await runDocker(cliArgs);
            if (res.code !== 0) {
                if (res.stderr.includes('pull access denied') || res.stderr.includes('not found')) {
                    // attempt auto-pull
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

    server.registerTool(
        'docker_stop_container',
        {
            description: 'Stop a container.',
            inputSchema: { type: 'object', properties: { container_id: { type: 'string' } }, required: ['container_id'], additionalProperties: false }
        },
        async (args) => {
            const res = await runDocker(['stop', args.container_id]);
            if (res.code !== 0) return mapDockerError(res.stderr || 'Failed to stop container');
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, message: res.stdout.trim() }) }] };
        }
    );

    server.registerTool(
        'docker_remove_container',
        {
            description: 'Remove a container.',
            inputSchema: {
                type: 'object',
                properties: { container_id: { type: 'string' }, force: { type: 'boolean', default: false } },
                required: ['container_id'],
                additionalProperties: false
            }
        },
        async (args) => {
            const cli = ['rm'];
            if (args.force) cli.push('-f');
            cli.push(args.container_id);
            const res = await runDocker(cli);
            if (res.code !== 0) return mapDockerError(res.stderr || 'Failed to remove container');
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, message: res.stdout.trim() }) }] };
        }
    );

    server.registerTool(
        'docker_exec',
        {
            description: 'Exec a command in a running container.',
            inputSchema: {
                type: 'object',
                properties: {
                    container_id: { type: 'string' },
                    command: { type: 'array', items: { type: 'string' } }
                },
                required: ['container_id', 'command'],
                additionalProperties: false
            }
        },
        async (args) => {
            const cli = ['exec', args.container_id, ...args.command];
            const res = await runDocker(cli);
            if (res.code !== 0) return mapDockerError(res.stderr || 'Exec failed');
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, exitCode: res.code, output: res.stdout }) }] };
        }
    );

    server.registerTool(
        'docker_list_images',
        { description: 'List local images.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
        async () => {
            const res = await runDocker(['images', '--format', '{{json .}}']);
            if (res.code !== 0) return mapDockerError(res.stderr);
            const images = res.stdout.trim().split('\n').filter(Boolean).map((line) => {
                try { return JSON.parse(line); } catch (_) { return null; }
            }).filter(Boolean);
            return { content: [{ type: 'text', text: JSON.stringify({ images }) }] };
        }
    );

    server.registerTool(
        'docker_pull_image',
        {
            description: 'Pull an image.',
            inputSchema: { type: 'object', properties: { image: { type: 'string' } }, required: ['image'], additionalProperties: false }
        },
        async (args) => {
            const res = await runDocker(['pull', args.image]);
            if (res.code !== 0) return mapDockerError(res.stderr);
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, output: res.stdout }) }] };
        }
    );

    server.registerTool(
        'docker_build_image',
        {
            description: 'Build an image from context.',
            inputSchema: {
                type: 'object',
                properties: {
                    context_path: { type: 'string' },
                    dockerfile_path: { type: 'string' },
                    tags: { type: 'array', items: { type: 'string' } }
                },
                required: ['context_path'],
                additionalProperties: false
            }
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

    server.registerTool(
        'docker_remove_image',
        {
            description: 'Remove an image.',
            inputSchema: { type: 'object', properties: { image: { type: 'string' }, force: { type: 'boolean', default: false } }, required: ['image'], additionalProperties: false }
        },
        async (args) => {
            const cli = ['rmi'];
            if (args.force) cli.push('-f');
            cli.push(args.image);
            const res = await runDocker(cli);
            if (res.code !== 0) return mapDockerError(res.stderr);
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, output: res.stdout }) }] };
        }
    );

    server.registerTool(
        'docker_get_logs',
        {
            description: 'Get container logs (stdout+stderr).',
            inputSchema: {
                type: 'object',
                properties: {
                    container_id: { type: 'string' },
                    tail: { type: 'number', description: 'Number of lines from the end' }
                },
                required: ['container_id'],
                additionalProperties: false
            }
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

    server.registerTool(
        'docker_inspect_container',
        {
            description: 'Inspect a container.',
            inputSchema: { type: 'object', properties: { container_id: { type: 'string' } }, required: ['container_id'], additionalProperties: false }
        },
        async (args) => {
            const res = await runDocker(['inspect', args.container_id]);
            if (res.code !== 0) return mapDockerError(res.stderr);
            let data;
            try { data = JSON.parse(res.stdout); } catch (_) { data = res.stdout; }
            return { content: [{ type: 'text', text: JSON.stringify({ inspect: data }) }] };
        }
    );

    // Networks
    server.registerTool(
        'docker_list_networks',
        { description: 'List Docker networks.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
        async () => {
            const res = await runDocker(['network', 'ls', '--format', '{{json .}}']);
            if (res.code !== 0) return mapDockerError(res.stderr);
            const networks = res.stdout.trim().split('\n').filter(Boolean).map((line) => {
                try { return JSON.parse(line); } catch (_) { return null; }
            }).filter(Boolean);
            return { content: [{ type: 'text', text: JSON.stringify({ networks }) }] };
        }
    );

    server.registerTool(
        'docker_create_network',
        {
            description: 'Create a Docker network.',
            inputSchema: { type: 'object', properties: { name: { type: 'string' }, driver: { type: 'string', default: 'bridge' } }, required: ['name'], additionalProperties: false }
        },
        async (args) => {
            const cli = ['network', 'create', '--driver', args.driver || 'bridge', args.name];
            const res = await runDocker(cli);
            if (res.code !== 0) return mapDockerError(res.stderr);
            return { content: [{ type: 'text', text: JSON.stringify({ networkId: res.stdout.trim() }) }] };
        }
    );

    server.registerTool(
        'docker_remove_network',
        {
            description: 'Remove a Docker network.',
            inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false }
        },
        async (args) => {
            const res = await runDocker(['network', 'rm', args.name]);
            if (res.code !== 0) return mapDockerError(res.stderr);
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, message: res.stdout.trim() }) }] };
        }
    );

    // Volumes
    server.registerTool(
        'docker_list_volumes',
        { description: 'List Docker volumes.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
        async () => {
            const res = await runDocker(['volume', 'ls', '--format', '{{json .}}']);
            if (res.code !== 0) return mapDockerError(res.stderr);
            const volumes = res.stdout.trim().split('\n').filter(Boolean).map((line) => {
                try { return JSON.parse(line); } catch (_) { return null; }
            }).filter(Boolean);
            return { content: [{ type: 'text', text: JSON.stringify({ volumes }) }] };
        }
    );

    server.registerTool(
        'docker_create_volume',
        {
            description: 'Create a Docker volume.',
            inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false }
        },
        async (args) => {
            const res = await runDocker(['volume', 'create', args.name]);
            if (res.code !== 0) return mapDockerError(res.stderr);
            return { content: [{ type: 'text', text: JSON.stringify({ volumeName: res.stdout.trim() }) }] };
        }
    );

    server.registerTool(
        'docker_remove_volume',
        {
            description: 'Remove a Docker volume.',
            inputSchema: { type: 'object', properties: { name: { type: 'string' }, force: { type: 'boolean', default: false } }, required: ['name'], additionalProperties: false }
        },
        async (args) => {
            const cli = ['volume', 'rm'];
            if (args.force) cli.push('-f');
            cli.push(args.name);
            const res = await runDocker(cli);
            if (res.code !== 0) return mapDockerError(res.stderr);
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, message: res.stdout.trim() }) }] };
        }
    );

    server.server.oninitialized = () => {
        console.log('Docker MCP server initialized.');
    };

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.log('Docker MCP server running on stdio.');
}

main().catch((err) => {
    console.error('Docker MCP server failed to start:', err);
    process.exit(1);
});
