const { __test } = require('../server');

describe('Zephyr cloud routing helpers', () => {
    test('normalizes site URL from API paths', () => {
        expect(__test.normalizeSiteUrl('https://example.atlassian.net/rest/atm/1.0')).toBe('https://example.atlassian.net');
        expect(__test.normalizeSiteUrl('https://example.atlassian.net/rest/api/3')).toBe('https://example.atlassian.net');
    });

    test('test case routes include singular/plural fallback', () => {
        expect(__test.testCaseSearchPaths()).toEqual(['/rest/atm/1.0/testcase/search', '/rest/atm/1.0/testcases/search']);
        expect(__test.testCaseCreatePaths()).toEqual(['/rest/atm/1.0/testcase', '/rest/atm/1.0/testcases']);
        expect(__test.testCasePaths('TC-1')).toEqual(['/rest/atm/1.0/testcase/TC-1', '/rest/atm/1.0/testcases/TC-1']);
    });

    test('execution and automation routes include fallback variants', () => {
        expect(__test.testExecutionListPaths()).toEqual(['/rest/atm/1.0/testrun/testexecution', '/rest/atm/1.0/testruns/testexecutions']);
        expect(__test.testExecutionUpdatePaths('10')).toEqual(['/rest/atm/1.0/testexecution/10', '/rest/atm/1.0/testexecutions/10']);
        expect(__test.automationExecutionPaths()).toEqual(['/rest/atm/1.0/automation/execution', '/rest/atm/1.0/automation/executions']);
    });
});
