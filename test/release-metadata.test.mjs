import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyReleaseMetadata } from '../scripts/verify-release.mjs';

const packageJson = {
  name: '@gamercc-apps/mockscreenshots-mcp',
  version: '0.1.7',
  mcpName: 'io.github.gamercc-apps/mockscreenshots-mcp',
  repository: { url: 'git+https://github.com/gamercc-apps/mockscreenshots-mcp.git' },
};
const packageLock = {
  name: packageJson.name,
  version: packageJson.version,
  packages: { '': { name: packageJson.name, version: packageJson.version } },
};
const serverJson = {
  $schema: 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json',
  name: packageJson.mcpName,
  version: packageJson.version,
  repository: { url: 'https://github.com/gamercc-apps/mockscreenshots-mcp', source: 'github' },
  packages: [{
    registryType: 'npm',
    identifier: packageJson.name,
    version: packageJson.version,
    transport: { type: 'stdio' },
  }],
};

test('release metadata accepts one consistent schema-bound npm package', () => {
  assert.doesNotThrow(() => verifyReleaseMetadata({ packageJson, packageLock, serverJson, tag: 'v0.1.7' }));
});

test('release metadata fails closed on tag, lockfile, registry, and schema drift', () => {
  const cases = [
    { tag: 'v0.1.8' },
    { packageLock: { ...packageLock, version: '0.1.6' } },
    { serverJson: { ...serverJson, version: '0.1.6' } },
    { serverJson: { ...serverJson, $schema: 'https://example.com/unreviewed-schema.json' } },
    { serverJson: { ...serverJson, packages: [...serverJson.packages, serverJson.packages[0]] } },
  ];
  for (const overrides of cases) {
    assert.throws(
      () => verifyReleaseMetadata({ packageJson, packageLock, serverJson, tag: 'v0.1.7', ...overrides }),
      /release metadata verification failed/i,
    );
  }
});
