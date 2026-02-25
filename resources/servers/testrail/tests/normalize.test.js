const { __test } = require('../server');

describe('TestRail URL normalization', () => {
    test('strips api v2 suffix', () => {
        expect(__test.normalizeBaseUrl('https://testrail.example.com/api/v2')).toBe('https://testrail.example.com');
    });

    test('strips index.php api suffix', () => {
        expect(__test.normalizeBaseUrl('https://testrail.example.com/index.php?/api/v2')).toBe('https://testrail.example.com');
    });

    test('strips index.php suffix', () => {
        expect(__test.normalizeBaseUrl('https://testrail.example.com/index.php')).toBe('https://testrail.example.com');
    });
});
