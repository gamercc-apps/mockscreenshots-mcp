import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDeepLink, buildRenderUrl } from '../server.mjs';

const state = { c: 'Mom', m: [{ t: 'hi', s: 'me' }] };

test('buildDeepLink points at the generator slug with ?s=', () => {
  const u = buildDeepLink('whatsapp', state);
  assert.ok(u.startsWith('https://mockscreenshots.com/fake-whatsapp-chat-generator?s='));
});

test('buildRenderUrl targets /api/render with platform+s (+scale)', () => {
  assert.ok(buildRenderUrl('imessage', state).startsWith('https://mockscreenshots.com/api/render?platform=imessage&s='));
  assert.match(buildRenderUrl('imessage', state, 1), /&scale=1$/);
});
