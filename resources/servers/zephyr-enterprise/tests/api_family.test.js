const { __test } = require('../server');

describe('Zephyr Enterprise API family routing helpers', () => {
    const originalFamily = __test.sessionConfig.api_family;
    const originalProject = __test.sessionConfig.project;
    const originalReleaseId = __test.sessionConfig.release_id;

    afterEach(() => {
        __test.sessionConfig.api_family = originalFamily;
        __test.sessionConfig.project = originalProject;
        __test.sessionConfig.release_id = originalReleaseId;
    });

    test('project paths vary by API family', () => {
        expect(__test.projectPathsFor(__test.API_FAMILY.PUBLIC)).toEqual(['public/rest/api/1.0/projects']);
        expect(__test.projectPathsFor(__test.API_FAMILY.FLEX)).toEqual([
            'flex/services/rest/latest/project/details',
            'flex/services/rest/latest/project'
        ]);
    });

    test('release creation paths vary by API family', () => {
        __test.sessionConfig.api_family = __test.API_FAMILY.PUBLIC;
        expect(__test.releaseCreatePaths()).toEqual(['public/rest/api/1.0/releases']);
        
        __test.sessionConfig.api_family = __test.API_FAMILY.FLEX;
        expect(__test.releaseCreatePaths()).toEqual(['flex/services/rest/v3/release']);
    });

    test('release update paths vary by API family', () => {
        __test.sessionConfig.api_family = __test.API_FAMILY.PUBLIC;
        expect(__test.releaseUpdatePaths(123)).toEqual(['public/rest/api/1.0/releases/123']);
        
        __test.sessionConfig.api_family = __test.API_FAMILY.FLEX;
        expect(__test.releaseUpdatePaths(123)).toEqual(['flex/services/rest/v3/release/123']);
    });

    test('release creation payload vary by API family', () => {
        __test.sessionConfig.project = { id: 42 };
        const args = { name: 'R1', status: 'S1', description: 'D1' };
        
        __test.sessionConfig.api_family = __test.API_FAMILY.PUBLIC;
        expect(__test.buildCreateReleasePayload(args)).toEqual({
            name: 'R1',
            status: 'S1',
            description: 'D1',
            projectId: 42,
            startDate: undefined,
            endDate: undefined
        });
        
        __test.sessionConfig.api_family = __test.API_FAMILY.FLEX;
        expect(__test.buildCreateReleasePayload(args)).toEqual({
            projectId: 42,
            release: {
                name: 'R1',
                status: 'S1',
                description: 'D1',
                startDate: undefined,
                endDate: undefined
            }
        });
    });

    test('release update payload vary by API family', () => {
        const args = { id: 101, status: 'Released' };
        
        __test.sessionConfig.api_family = __test.API_FAMILY.PUBLIC;
        expect(__test.buildUpdateReleasePayload(args)).toEqual({
            status: 'Released'
        });
        
        __test.sessionConfig.api_family = __test.API_FAMILY.FLEX;
        expect(__test.buildUpdateReleasePayload(args)).toEqual({
            release: { status: 'Released' }
        });
    });

    test('create payload uses public shape by default', () => {
        __test.sessionConfig.api_family = __test.API_FAMILY.PUBLIC;
        __test.sessionConfig.project = { id: 42, key: 'QA' };
        const payload = __test.buildCreateTestCasePayload({ name: 'TC One', description: 'desc', folder_id: 7 });

        expect(payload).toMatchObject({
            projectId: 42,
            name: 'TC One',
            description: 'desc',
            folderId: 7
        });
    });

    test('create payload uses flex shape when configured', () => {
        __test.sessionConfig.api_family = __test.API_FAMILY.FLEX;
        const payload = __test.buildCreateTestCasePayload({ name: 'TC Flex', folder_id: 9 });

        expect(payload).toMatchObject({
            tcrCatalogTreeId: 9,
            testcase: { name: 'TC Flex' }
        });
        expect(payload.projectId).toBeUndefined();
    });

    test('create payload accepts camelCase aliases for flex calls', () => {
        __test.sessionConfig.api_family = __test.API_FAMILY.FLEX;
        __test.sessionConfig.release_id = 8;
        const payload = __test.buildCreateTestCasePayload({
            name: 'TC Flex Alias',
            description: 'desc',
            folderId: 1107,
            priority: 2,
            customFields: { owner: 'qa' }
        });

        expect(payload).toMatchObject({
            tcrCatalogTreeId: 1107,
            testcase: {
                name: 'TC Flex Alias',
                description: 'desc',
                priority: '2',
                customFields: { owner: 'qa' }
            }
        });
    });

    test('search spec uses flex advancesearch endpoint and wildcard fallback', () => {
        __test.sessionConfig.api_family = __test.API_FAMILY.FLEX;
        __test.sessionConfig.release_id = 123;
        const spec = __test.testCaseSearchSpec({});

        expect(spec.paths).toEqual(['flex/services/rest/latest/advancesearch']);
        expect(spec.options.method).toBe('GET');
        expect(spec.options.query).toMatchObject({
            word: '*',
            entitytype: 'testcase',
            releaseid: '123'
        });
    });

    test('update spec uses flex endpoint and query flag', () => {
        __test.sessionConfig.api_family = __test.API_FAMILY.FLEX;
        const spec = __test.testCaseUpdateSpec(88);

        expect(spec.paths).toEqual(['flex/services/rest/latest/testcase']);
        expect(spec.options).toMatchObject({
            method: 'PUT',
            query: { forceCreateNewVersion: 'false' }
        });
    });

    test('update payload accepts camelCase aliases and carries release id', () => {
        __test.sessionConfig.api_family = __test.API_FAMILY.FLEX;
        __test.sessionConfig.release_id = 8;
        const payload = __test.buildUpdateTestCasePayload({
            testCaseId: 23117,
            folderId: 1107,
            priority: 2,
            customFields: { owner: 'qa' }
        });

        expect(payload).toMatchObject({
            tcrCatalogTreeId: 1107,
            releaseId: 8,
            testcase: {
                testcaseId: 23117,
                priority: '2',
                customFields: { owner: 'qa' }
            }
        });
    });

    test('extractProjects handles multiple response shapes', () => {
        expect(__test.extractProjects({ values: [{ id: 1, key: 'A' }] })).toEqual([{ id: 1, key: 'A' }]);
        expect(__test.extractProjects({ projects: [{ projectId: 2, projectKey: 'B' }] })).toEqual([{ id: 2, key: 'B' }]);
        expect(__test.extractProjects([{ id: 3, name: 'C' }])).toEqual([{ id: 3, key: 'C' }]);
    });

    test('folder request specs prefer flex tree endpoints and fall back to public', () => {
        __test.sessionConfig.api_family = __test.API_FAMILY.FLEX;
        __test.sessionConfig.project = { id: 4, key: 'QA' };
        __test.sessionConfig.release_id = 8;

        expect(__test.folderRequestSpecsFor({})).toEqual([
            { path: 'flex/services/rest/v3/testcasetree', query: { releaseid: '8' } },
            { path: 'flex/services/rest/v3/testcasetree', query: { releaseId: '8' } },
            { path: 'flex/services/rest/latest/testcasetree', query: { releaseid: '8' } },
            { path: 'flex/services/rest/latest/testcasetree', query: { releaseId: '8' } },
            { path: 'public/rest/api/1.0/folders', query: { projectId: '4' } }
        ]);
    });

    test('extractFolders handles public and flex response shapes', () => {
        expect(__test.extractFolders([{ id: 1, name: 'Root' }])).toEqual([{ id: 1, name: 'Root' }]);
        expect(__test.extractFolders({ folders: [{ id: 2, name: 'Child' }] })).toEqual([{ id: 2, name: 'Child' }]);
        expect(__test.extractFolders({ testcaseTreeGridResponseList: [{ treeid: 3, name: 'Phase' }] })).toEqual([{ treeid: 3, name: 'Phase' }]);
    });

    test('normalizeTestCaseArgs accepts camelCase aliases', () => {
        expect(__test.normalizeTestCaseArgs({
            testCaseId: '23117',
            folderId: '1107',
            releaseId: '8',
            priority: 2,
            customFields: { owner: 'qa' }
        })).toMatchObject({
            id: 23117,
            folder_id: 1107,
            release_id: 8,
            priority: '2',
            custom_fields: { owner: 'qa' }
        });
    });

    test('lazy api-family detection falls back to flex when public projects endpoint is missing', async () => {
        __test.sessionConfig.base_url = 'https://example.test';
        __test.sessionConfig.auth = { type: 'basic', username: 'u', password: 'p' };
        __test.sessionConfig.api_family = undefined;

        const fetchMock = jest.fn(async (url) => {
            if (String(url).includes('/public/rest/api/1.0/projects')) {
                return {
                    ok: false,
                    status: 404,
                    statusText: 'Not Found',
                    text: async () => '<html>404</html>'
                };
            }
            if (String(url).includes('/flex/services/rest/latest/project/details')) {
                return {
                    ok: true,
                    status: 200,
                    statusText: 'OK',
                    text: async () => '[]'
                };
            }
            return {
                ok: false,
                status: 404,
                statusText: 'Not Found',
                text: async () => ''
            };
        });

        const originalFetch = global.fetch;
        global.fetch = fetchMock;
        try {
            await __test.ensureApiFamilyDetected();
            expect(__test.sessionConfig.api_family).toBe(__test.API_FAMILY.FLEX);
            expect(fetchMock).toHaveBeenCalled();
        } finally {
            global.fetch = originalFetch;
        }
    });
});
