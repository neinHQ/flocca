const { __test } = require('../server');
const { normalizeError, apiPathCandidates } = __test;

describe('Confluence Server Logic', () => {
    describe('normalizeError', () => {
        it('should extract message from simple error object', () => {
            const err = { response: { data: { message: 'Specific Error' } } };
            const result = normalizeError(err);
            expect(result.content[0].text).toContain('Specific Error');
        });

        it('should extract multiple messages from Cloud-style errors array', () => {
            const err = {
                response: {
                    data: {
                        errors: [
                            { message: 'First error' },
                            { message: 'Second error' }
                        ]
                    }
                }
            };
            const result = normalizeError(err);
            expect(result.content[0].text).toContain('First error, Second error');
        });

        it('should fallback to err.message if no response data', () => {
            const err = new Error('Generic Network Error');
            const result = normalizeError(err);
            expect(result.content[0].text).toContain('Generic Network Error');
        });
    });

    describe('apiPathCandidates', () => {
        it('should prioritize /rest/api for server mode', () => {
            __test.setConfig({ deploymentMode: 'server' });
            const paths = apiPathCandidates('space');
            expect(paths[0]).toBe('/rest/api/space');
        });

        it('should prioritize /wiki/rest/api for cloud mode', () => {
            __test.setConfig({ deploymentMode: 'cloud' });
            const paths = apiPathCandidates('space');
            expect(paths[0]).toBe('/wiki/rest/api/space');
        });
    });
});
