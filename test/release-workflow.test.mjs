import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/publish.yml', import.meta.url), 'utf8');
const ciWorkflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const stepIndex = (name) => {
  const index = workflow.indexOf(`- name: ${name}`);
  assert.notEqual(index, -1, `missing release step: ${name}`);
  return index;
};

test('release workflow is tag-only and pins third-party actions and publisher artifact', () => {
  assert.match(workflow, /push:\s*\n\s+tags: \['v\*'\]/);
  assert.doesNotMatch(workflow, /^\s+branches:/m);
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40}\b/);
  assert.match(workflow, /actions\/setup-node@[0-9a-f]{40}\b/);
  assert.doesNotMatch(`${workflow}\n${ciWorkflow}`, /uses:\s+[^\s]+@(v\d+|main|master|latest)\b/);
  assert.match(workflow, /releases\/download\/v\d+\.\d+\.\d+\/mcp-publisher_linux_amd64\.tar\.gz/);
  assert.match(workflow, /1370446bbe74d562608e8005a6ccce02d146a661fbd78674e11cc70b9618d6cf\s+\$ARCHIVE/);
  assert.match(workflow, /sha256sum --check/);
  assert.doesNotMatch(workflow, /releases\/latest\//);
});

test('release gates exact tag commit, metadata, tests, and five-file package before publishing', () => {
  const exactCommit = stepIndex('Verify exact tag commit and version metadata');
  const tests = stepIndex('Run tests');
  const pack = stepIndex('Verify exact npm package contents');
  const npmPublish = stepIndex('Publish to npm');
  const registryPublish = stepIndex('Publish to MCP registry');

  assert.ok(exactCommit < tests && tests < pack && pack < npmPublish && npmPublish < registryPublish);
  assert.match(workflow, /git rev-parse HEAD/);
  assert.match(workflow, /git rev-parse "\$\{GITHUB_REF\}\^\{commit\}"/);
  assert.match(workflow, /node scripts\/verify-release\.mjs/);
  assert.match(workflow, /\.\/mcp-publisher validate server\.json/);
  assert.match(workflow, /npm test/);
  for (const file of ['LICENSE', 'README.md', 'package.json', 'server.json', 'server.mjs']) {
    assert.match(workflow, new RegExp(`['"]${file.replace('.', '\\.') }['"]`));
  }
});

test('npm provenance and registry ownership remain separate credential gates', () => {
  assert.match(workflow, /npm publish --access public --provenance/);
  assert.match(workflow, /NODE_AUTH_TOKEN:\s*\$\{\{ secrets\.NPM_TOKEN \}\}/);
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /mcp-publisher login github-oidc/);
  assert.doesNotMatch(workflow.slice(stepIndex('Publish to MCP registry')), /NPM_TOKEN/);
});
