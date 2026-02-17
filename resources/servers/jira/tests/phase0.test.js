jest.mock('axios', () => ({ get: jest.fn() }));

const axios = require('axios');
const { __test } = require('../server');

describe('Jira Phase 0', () => {
  beforeEach(() => {
    axios.get.mockReset();
    __test.setConfig({ url: 'https://jira.example.com', deploymentMode: 'cloud' });
  });

  test('normalizes base URL by removing trailing slash', () => {
    expect(__test.normalizeBaseUrl('https://jira.example.com/')).toBe('https://jira.example.com');
  });

  test('uses cloud-first API order by default', () => {
    __test.setConfig({ deploymentMode: 'cloud' });
    expect(__test.getApiVersions()).toEqual(['3', '2']);
  });

  test('uses server-first API order for server mode', () => {
    __test.setConfig({ deploymentMode: 'server' });
    expect(__test.getApiVersions()).toEqual(['2', '3']);
  });

  test('falls back from v3 to v2 on 404', async () => {
    axios.get
      .mockRejectedValueOnce({ response: { status: 404 } })
      .mockResolvedValueOnce({ data: { ok: true } });

    const res = await __test.jiraGet('myself', { headers: { test: '1' } });
    expect(res.data.ok).toBe(true);
    expect(axios.get).toHaveBeenCalledTimes(2);
    expect(axios.get.mock.calls[0][0]).toContain('/rest/api/3/myself');
    expect(axios.get.mock.calls[1][0]).toContain('/rest/api/2/myself');
  });
});
