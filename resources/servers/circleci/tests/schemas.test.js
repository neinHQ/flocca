const { createCircleCiServer } = require('../server');

describe('CircleCI MCP Schema Validation', () => {
    let server;

    beforeEach(() => {
        server = createCircleCiServer();
    });

    const getValidator = (name) => {
        const tool = server._registeredTools[name];
        if (!tool) throw new Error(`Tool ${name} not found`);
        return tool.inputSchema;
    };

    describe('circleci_trigger_pipeline', () => {
        it('should require project_slug and confirm', () => {
            const schema = getValidator('circleci_trigger_pipeline');
            const valid = { project_slug: 'gh/org/repo', confirm: true };
            expect(schema.safeParse(valid).success).toBe(true);
            expect(schema.safeParse({ ...valid, confirm: undefined }).success).toBe(false);
        });
    });

    describe('circleci_cancel_job', () => {
        it('should require project_slug, job_number, and confirm', () => {
            const schema = getValidator('circleci_cancel_job');
            const valid = { project_slug: 'gh/org/repo', job_number: 123, confirm: true };
            expect(schema.safeParse(valid).success).toBe(true);
            expect(schema.safeParse({ ...valid, job_number: 'not-a-number' }).success).toBe(false);
        });
    });

    describe('circleci_rerun_workflow', () => {
        it('should require workflow_id and confirm', () => {
            const schema = getValidator('circleci_rerun_workflow');
            const valid = { workflow_id: 'w1', confirm: true };
            expect(schema.safeParse(valid).success).toBe(true);
            expect(schema.safeParse({ ...valid, confirm: undefined }).success).toBe(false);
        });
    });

    describe('circleci_get_job_details', () => {
        it('should require project_slug and job_number', () => {
            const schema = getValidator('circleci_get_job_details');
            expect(schema.safeParse({ project_slug: 'gh/o/r', job_number: 1 }).success).toBe(true);
            expect(schema.safeParse({ project_slug: 'gh/o/r' }).success).toBe(false);
        });
    });
});
