const { __test } = require('../server');

describe('Sentry URL normalization', () => {
    test('appends api root when missing', () => {
        expect(__test.normalizeBaseUrl('https://sentry.io')).toBe('https://sentry.io/api/0');
    });

    test('keeps api root when already present', () => {
        expect(__test.normalizeBaseUrl('https://sentry.io/api/0')).toBe('https://sentry.io/api/0');
    });
});
