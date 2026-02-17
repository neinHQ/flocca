const { __test } = require('../server');

describe('GitHub Actions Phase 0', () => {
  test('normalizes GHES API URL with /api/v3 suffix', () => {
    expect(__test.normalizeGitHubApiUrl('https://github.company.com')).toBe('https://github.company.com/api/v3');
    expect(__test.normalizeGitHubApiUrl('https://github.company.com/api/v3')).toBe('https://github.company.com/api/v3');
  });
});
