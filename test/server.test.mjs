import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDeepLink, buildRenderUrl } from '../server.mjs';

const state = { c: 'Mom', m: [{ t: 'hi', s: 'me' }] };
const serverPath = fileURLToPath(new URL('../server.mjs', import.meta.url));

test('buildDeepLink points at the generator slug with ?s=', () => {
  const u = buildDeepLink('whatsapp', state);
  assert.ok(u.startsWith('https://mockscreenshots.com/fake-whatsapp-chat-generator?s='));
});

test('buildRenderUrl targets /api/render with platform+s (+scale)', () => {
  assert.ok(buildRenderUrl('imessage', state).startsWith('https://mockscreenshots.com/api/render?platform=imessage&s='));
  assert.match(buildRenderUrl('imessage', state, 1), /&scale=1$/);
});

test('main-guard starts the stdio server when launched via a symlink (bin path)', async () => {
  // Regression test for C1: process.argv[1] is not realpath'd by Node, but
  // import.meta.url is — so launching via a symlink (as npx/bin installs do)
  // must still be recognized as "main" and start the stdio server.
  const dir = mkdtempSync(join(tmpdir(), 'ms-bin-'));
  const linkPath = join(dir, 'ms-bin.mjs');
  symlinkSync(serverPath, linkPath);

  const child = spawn(process.execPath, [linkPath], { stdio: ['ignore', 'ignore', 'pipe'] });

  try {
    await new Promise((resolve, reject) => {
      let out = '';
      const timer = setTimeout(
        () => reject(new Error(`timed out waiting for ready line; stderr so far: ${out}`)),
        5000,
      );
      child.stderr.on('data', (chunk) => {
        out += chunk.toString();
        if (out.includes('mockscreenshots-mcp running on stdio')) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  } finally {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
