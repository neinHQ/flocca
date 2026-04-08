const { __test: { API_FAMILY, sessionConfig, releaseDeletePaths } } = require('../server');

describe('Release Deletion Logic', () => {
    beforeEach(() => {
        sessionConfig.api_family = API_FAMILY.PUBLIC;
    });

    test('Public: returns correct delete path', () => {
        sessionConfig.api_family = API_FAMILY.PUBLIC;
        const paths = releaseDeletePaths(123);
        expect(paths).toContain('public/rest/api/1.0/releases/123');
    });

    test('Flex: returns correct delete path', () => {
        sessionConfig.api_family = API_FAMILY.FLEX;
        const paths = releaseDeletePaths(123);
        expect(paths).toContain('flex/services/rest/v3/release/123');
    });
});
