const { createDockerServer } = require('../server');
const { spawn } = require('child_process');
const EventEmitter = require('events');

jest.mock('child_process');

describe('Docker MCP Tools Logic', () => {
    let server;
    let mockSpawn;

    beforeEach(() => {
        jest.clearAllMocks();
        server = createDockerServer();
        mockSpawn = spawn;
    });

    const setupMockProcess = ({ code = 0, stdout = '', stderr = '' } = {}) => {
        const stdoutEmitter = new EventEmitter();
        const stderrEmitter = new EventEmitter();
        const processEmitter = new EventEmitter();
        processEmitter.stdout = stdoutEmitter;
        processEmitter.stderr = stderrEmitter;
        processEmitter.stdin = { write: jest.fn(), end: jest.fn() };

        mockSpawn.mockReturnValue(processEmitter);

        setImmediate(() => {
            if (stdout) stdoutEmitter.emit('data', stdout);
            if (stderr) stderrEmitter.emit('data', stderr);
            processEmitter.emit('close', code);
        });
    };

    const callTool = async (name, args = {}) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return await tool.handler(args);
    };

    describe('docker_list_containers', () => {
        it('should parse multiple containers from JSON output', async () => {
            const mockOutput = 
                JSON.stringify({ ID: '123', Image: 'nginx', Status: 'Up' }) + '\n' +
                JSON.stringify({ ID: '456', Image: 'redis', Status: 'Exited' });
            
            setupMockProcess({ stdout: mockOutput });

            const result = await callTool('docker_list_containers', { all: true });
            const data = JSON.parse(result.content[0].text);
            
            expect(data.containers).toHaveLength(2);
            expect(data.containers[0].ID).toBe('123');
            expect(data.containers[1].Image).toBe('redis');
            expect(mockSpawn).toHaveBeenCalledWith('docker', expect.arrayContaining(['ps', '-a']), expect.any(Object));
        });
    });

    describe('docker_run_container', () => {
        it('should correctly build CLI arguments for env and mounts', async () => {
            setupMockProcess({ stdout: 'container-id-789' });

            await callTool('docker_run_container', {
                image: 'alpine',
                name: 'test-box',
                env: { NODE_ENV: 'production', DEBUG: 'true' },
                mounts: [
                    { type: 'bind', source: '/local/path', target: '/container/path' }
                ]
            });

            const calledArgs = mockSpawn.mock.calls[0][1];
            expect(calledArgs).toContain('run');
            expect(calledArgs).toContain('--name');
            expect(calledArgs).toContain('test-box');
            expect(calledArgs).toContain('-e');
            expect(calledArgs).toContain('NODE_ENV=production');
            expect(calledArgs).toContain('--mount');
            expect(calledArgs).toContain('type=bind,source=/local/path,target=/container/path');
            expect(calledArgs).toContain('alpine');
        });

        it('should attempt auto-pull if image is missing', async () => {
            // First call fails with "not found"
            const stdout1 = '';
            const stderr1 = 'Error response from daemon: pull access denied for alpine, repository does not exist or may require \'docker login\': denied: requested access to the resource is denied';
            
            // Second call (pull) succeeds
            const stdout2 = 'Image pulled';
            
            // Third call (retry run) succeeds
            const stdout3 = 'retry-container-id';

            const process1 = new EventEmitter();
            process1.stdout = new EventEmitter();
            process1.stderr = new EventEmitter();
            process1.stdin = { write: jest.fn(), end: jest.fn() };

            const process2 = new EventEmitter();
            process2.stdout = new EventEmitter();
            process2.stderr = new EventEmitter();
            process2.stdin = { write: jest.fn(), end: jest.fn() };

            const process3 = new EventEmitter();
            process3.stdout = new EventEmitter();
            process3.stderr = new EventEmitter();
            process3.stdin = { write: jest.fn(), end: jest.fn() };

            mockSpawn
                .mockReturnValueOnce(process1)
                .mockReturnValueOnce(process2)
                .mockReturnValueOnce(process3);

            setImmediate(() => {
                process1.stderr.emit('data', stderr1);
                process1.emit('close', 1);
                
                setImmediate(() => {
                    process2.stdout.emit('data', stdout2);
                    process2.emit('close', 0);
                    
                    setImmediate(() => {
                        process3.stdout.emit('data', stdout3);
                        process3.emit('close', 0);
                    });
                });
            });

            const result = await callTool('docker_run_container', { image: 'alpine' });
            const data = JSON.parse(result.content[0].text);
            expect(data.containerId).toBe('retry-container-id');
            expect(mockSpawn).toHaveBeenCalledTimes(3);
        });
    });

    describe('docker_container_stats', () => {
        it('should return parsed JSON stats', async () => {
            const mockStats = JSON.stringify({ Container: '123', CPUPerc: '0.5%', MemUsage: '10MiB' });
            setupMockProcess({ stdout: mockStats });

            const result = await callTool('docker_container_stats', { container_id: '123' });
            const data = JSON.parse(result.content[0].text);
            
            expect(data.stats[0].Container).toBe('123');
            expect(data.stats[0].CPUPerc).toBe('0.5%');
        });
    });

    describe('docker_system_prune', () => {
        it('should require confirm: true', async () => {
            const result = await callTool('docker_system_prune', { all: true });
            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('CONFIRMATION_REQUIRED');
        });

        it('should include --all and --volumes when requested and confirmed', async () => {
            setupMockProcess({ stdout: 'Total reclaimed space: 0B' });

            await callTool('docker_system_prune', { all: true, volumes: true, confirm: true });

            const calledArgs = mockSpawn.mock.calls[0][1];
            expect(calledArgs).toContain('system');
            expect(calledArgs).toContain('prune');
            expect(calledArgs).toContain('--all');
            expect(calledArgs).toContain('--volumes');
            expect(calledArgs).toContain('-f');
        });
    });

    describe('docker_stop_container', () => {
        it('should require confirm: true', async () => {
            const result = await callTool('docker_stop_container', { container_id: '123' });
            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('CONFIRMATION_REQUIRED');
        });

        it('should call docker stop when confirmed', async () => {
            setupMockProcess({ stdout: '123' });
            await callTool('docker_stop_container', { container_id: '123', confirm: true });
            expect(mockSpawn).toHaveBeenCalledWith('docker', expect.arrayContaining(['stop', '123']), expect.any(Object));
        });
    });

    describe('docker_remove_image', () => {
        it('should require confirm: true', async () => {
            const result = await callTool('docker_remove_image', { image: 'alpine' });
            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('CONFIRMATION_REQUIRED');
        });

        it('should call docker rmi when confirmed', async () => {
            setupMockProcess({ stdout: 'Untagged: alpine:latest' });
            await callTool('docker_remove_image', { image: 'alpine', confirm: true });
            expect(mockSpawn).toHaveBeenCalledWith('docker', expect.arrayContaining(['rmi', 'alpine']), expect.any(Object));
        });
    });
});
