import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

suite('Phase 0 Env Mapping Regression', () => {
  test('extension maps connector env vars expected by servers', () => {
    const extensionPath = path.resolve(__dirname, '../../extension.ts');
    const src = fs.readFileSync(extensionPath, 'utf8');

    const expectedSnippets = [
      "'AZURE_DEVOPS_ORG_URL': data.org_url",
      "'AZURE_DEVOPS_PROJECT': data.project",
      "'AZURE_DEVOPS_TOKEN': data.token",
      "'TESTRAIL_BASE_URL': data.url",
      "'TESTRAIL_PROJECT_ID': data.project_id || ''",
      "'CYPRESS_PROJECT_ROOT': data.project_root",
      "'BITBUCKET_SERVICE_URL': data.url || ''",
      "'JIRA_DEPLOYMENT_MODE': data.deployment_mode || ''",
      "'CONFLUENCE_DEPLOYMENT_MODE': data.deployment_mode || ''",
      "'GITHUB_API_URL': data.api_url || ''",
      "'FIGMA_TOKEN': data.token"
    ];

    for (const snippet of expectedSnippets) {
      assert.ok(src.includes(snippet), `Missing mapping snippet: ${snippet}`);
    }
  });
});
