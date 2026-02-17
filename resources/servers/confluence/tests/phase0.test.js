jest.mock('axios', () => jest.fn());

const axios = require('axios');
const { __test } = require('../server');

describe('Confluence Phase 0', () => {
  beforeEach(() => {
    axios.mockReset();
    __test.setConfig({ baseUrl: 'https://conf.example.com', deploymentMode: 'cloud' });
  });

  test('normalizes base URL by removing /wiki and trailing slash', () => {
    expect(__test.normalizeBaseUrl('https://conf.example.com/wiki/')).toBe('https://conf.example.com');
  });

  test('cloud mode tries /wiki/rest/api first', () => {
    __test.setConfig({ deploymentMode: 'cloud' });
    expect(__test.apiPathCandidates('space')).toEqual(['/wiki/rest/api/space', '/rest/api/space']);
  });

  test('server mode tries /rest/api first', () => {
    __test.setConfig({ deploymentMode: 'server' });
    expect(__test.apiPathCandidates('space')).toEqual(['/rest/api/space', '/wiki/rest/api/space']);
  });

  test('falls back to server path when cloud path returns 404', async () => {
    axios
      .mockRejectedValueOnce({ response: { status: 404 } })
      .mockResolvedValueOnce({ data: { ok: true } });

    const res = await __test.confluenceRequest('get', 'space', undefined, { headers: { t: '1' } });
    expect(res.data.ok).toBe(true);
    expect(axios).toHaveBeenCalledTimes(2);
    expect(axios.mock.calls[0][0].url).toContain('/wiki/rest/api/space');
    expect(axios.mock.calls[1][0].url).toContain('/rest/api/space');
  });
});
