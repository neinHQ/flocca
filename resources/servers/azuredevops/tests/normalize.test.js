const { __test } = require('../server');

describe('Azure DevOps URL normalization', () => {
    test('strips _apis suffix and project suffix', () => {
        expect(__test.normalizeServiceUrl('https://dev.azure.com/myorg/myproj/_apis', 'myproj')).toBe('https://dev.azure.com/myorg');
    });

    test('strips _git suffix path', () => {
        expect(__test.normalizeServiceUrl('https://dev.azure.com/myorg/myproj/_git/repo', 'myproj')).toBe('https://dev.azure.com/myorg');
    });

    test('keeps already normalized org url', () => {
        expect(__test.normalizeServiceUrl('https://dev.azure.com/myorg', 'myproj')).toBe('https://dev.azure.com/myorg');
    });
});
