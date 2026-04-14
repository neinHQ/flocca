const { createJenkinsServer } = require('../server');

describe('Jenkins MCP Schema Validation', () => {
    let server;

    beforeEach(() => {
        server = createJenkinsServer();
    });

    const getValidator = (name) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return tool.inputSchema;
    };

    describe('jenkins_build_job', () => {
        it('should require job_name and confirm', () => {
            const schema = getValidator('jenkins_build_job');
            const valid = { job_name: 'test-job', confirm: true };
            expect(schema.safeParse(valid).success).toBe(true);
            expect(schema.safeParse({ ...valid, confirm: undefined }).success).toBe(false);
        });
    });

    describe('jenkins_abort_build', () => {
        it('should require job_name, build_number, and confirm', () => {
            const schema = getValidator('jenkins_abort_build');
            const valid = { job_name: 'test-job', build_number: 10, confirm: true };
            expect(schema.safeParse(valid).success).toBe(true);
            expect(schema.safeParse({ ...valid, build_number: 'ten' }).success).toBe(false);
        });
    });

    describe('jenkins_get_console_output', () => {
        it('should require job_name and build_number', () => {
            const schema = getValidator('jenkins_get_console_output');
            expect(schema.safeParse({ job_name: 'j1', build_number: 1 }).success).toBe(true);
            expect(schema.safeParse({ job_name: 'j1' }).success).toBe(false);
        });
    });
});
