import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const EXPECTED_SCHEMA = 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json';
const EXPECTED_REPOSITORY = 'https://github.com/gamercc-apps/mockscreenshots-mcp';
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function verifyReleaseMetadata({ packageJson, packageLock, serverJson, tag }) {
  const failures = [];
  const expectEqual = (actual, expected, label) => {
    if (actual !== expected) failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  };

  if (!SEMVER.test(packageJson.version ?? '')) failures.push('package.json version must be valid semver');
  expectEqual(tag, `v${packageJson.version}`, 'tag/package version');
  expectEqual(packageLock.name, packageJson.name, 'lockfile package name');
  expectEqual(packageLock.version, packageJson.version, 'lockfile package version');
  expectEqual(packageLock.packages?.['']?.name, packageJson.name, 'lockfile root package name');
  expectEqual(packageLock.packages?.['']?.version, packageJson.version, 'lockfile root package version');

  expectEqual(serverJson.$schema, EXPECTED_SCHEMA, 'server schema revision');
  expectEqual(serverJson.name, packageJson.mcpName, 'MCP server/package name');
  expectEqual(serverJson.version, packageJson.version, 'MCP server/package version');
  expectEqual(serverJson.repository?.url, EXPECTED_REPOSITORY, 'MCP repository URL');
  expectEqual(serverJson.repository?.source, 'github', 'MCP repository source');
  if (!Array.isArray(serverJson.packages) || serverJson.packages.length !== 1) {
    failures.push('server.json must declare exactly one package');
  } else {
    const [registryPackage] = serverJson.packages;
    expectEqual(registryPackage.registryType, 'npm', 'MCP package registry type');
    expectEqual(registryPackage.identifier, packageJson.name, 'MCP/npm package name');
    expectEqual(registryPackage.version, packageJson.version, 'MCP/npm package version');
    expectEqual(registryPackage.transport?.type, 'stdio', 'MCP package transport');
  }

  const packageRepository = packageJson.repository?.url
    ?.replace(/^git\+/, '')
    .replace(/\.git$/, '');
  expectEqual(packageRepository, EXPECTED_REPOSITORY, 'npm repository URL');

  if (failures.length > 0) {
    throw new Error(`Release metadata verification failed:\n- ${failures.join('\n- ')}`);
  }
}

function main() {
  const tag = process.argv[2] || process.env.GITHUB_REF_NAME;
  if (!tag) throw new Error('Release metadata verification failed: release tag is required');
  verifyReleaseMetadata({
    packageJson: JSON.parse(readFileSync('package.json', 'utf8')),
    packageLock: JSON.parse(readFileSync('package-lock.json', 'utf8')),
    serverJson: JSON.parse(readFileSync('server.json', 'utf8')),
    tag,
  });
  console.log(`Verified release metadata for ${tag}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
