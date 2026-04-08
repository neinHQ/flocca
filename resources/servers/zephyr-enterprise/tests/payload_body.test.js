const { __test: { API_FAMILY, sessionConfig, buildCreateReleasePayload, buildUpdateReleasePayload } } = require('../server');

describe('Release Payload Hardening', () => {
    beforeEach(() => {
        sessionConfig.project = { id: 10 };
        sessionConfig.release_id = 100;
        sessionConfig.api_family = API_FAMILY.PUBLIC;
    });

    describe('buildCreateReleasePayload', () => {
        const fullArgs = {
            name: 'v2.0',
            status: 'Released',
            description: 'Major Update',
            start_date: '2026-05-01',
            end_date: '2026-06-01'
        };

        test('Public: includes all fields at top level', () => {
            sessionConfig.api_family = API_FAMILY.PUBLIC;
            const payload = buildCreateReleasePayload(fullArgs);
            expect(payload).toEqual({
                name: 'v2.0',
                status: 'Released',
                description: 'Major Update',
                startDate: '2026-05-01',
                endDate: '2026-06-01',
                projectId: 10
            });
        });

        test('Flex: includes all fields nested under release', () => {
            sessionConfig.api_family = API_FAMILY.FLEX;
            const payload = buildCreateReleasePayload(fullArgs);
            expect(payload.projectId).toBe(10);
            expect(payload.release).toEqual({
                name: 'v2.0',
                status: 'Released',
                description: 'Major Update',
                startDate: '2026-05-01',
                endDate: '2026-06-01'
            });
        });

        test('handles camelCase arguments (startDate/endDate)', () => {
             const camelArgs = {
                 name: 'v2.1',
                 status: 'Draft',
                 startDate: '2026-07-01',
                 endDate: '2026-08-01'
             };
             const payload = buildCreateReleasePayload(camelArgs);
             expect(payload.startDate).toBe('2026-07-01');
             expect(payload.endDate).toBe('2026-08-01');
             expect(payload.status).toBe('Draft');
        });
    });

    describe('buildUpdateReleasePayload', () => {
        test('Public: includes provided fields only', () => {
            sessionConfig.api_family = API_FAMILY.PUBLIC;
            const payload = buildUpdateReleasePayload({ id: 1, status: 'Active' });
            expect(payload).toEqual({ status: 'Active' });
            expect(payload.name).toBeUndefined();
        });

        test('Flex: nests provided fields under release', () => {
            sessionConfig.api_family = API_FAMILY.FLEX;
            const payload = buildUpdateReleasePayload({ id: 1, description: 'New Desc', status: 'In Progress' });
            expect(payload).toEqual({
                release: {
                    description: 'New Desc',
                    status: 'In Progress'
                }
            });
        });
    });
});
