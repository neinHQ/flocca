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

    test('extractProjects handles multiple response shapes', () => {
        expect(__test.extractProjects({ values: [{ id: 1, key: 'A' }] })).toEqual([{ id: 1, key: 'A' }]);
        expect(__test.extractProjects({ projects: [{ projectId: 2, projectKey: 'B' }] })).toEqual([{ id: 2, key: 'B' }]);
        expect(__test.extractProjects([{ id: 3, name: 'C' }])).toEqual([{ id: 3, key: 'C' }]);
    });
});
