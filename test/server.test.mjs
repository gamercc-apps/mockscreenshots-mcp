import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, symlinkSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { buildDeepLink, buildRenderUrl } from '../server.mjs';

const state = { c: 'Mom', m: [{ t: 'hi', s: 'me' }] };
const serverPath = fileURLToPath(new URL('../server.mjs', import.meta.url));
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZrE0AAAAASUVORK5CYII=';

const decodeStateFromUrl = (url) => {
  const encoded = new URL(url).searchParams.get('s');
  return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
};

async function withStdioClient(run, env = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: { ...process.env, ...env },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'mockscreenshots-integration-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    return await run(client);
  } finally {
    await client.close();
  }
}

async function withRenderServer(handler, run) {
  const httpServer = createServer(handler);
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address();
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => httpServer.close(resolve));
  }
}

test('buildDeepLink points at the generator slug with ?s=', () => {
  const u = buildDeepLink('whatsapp', state);
  assert.ok(u.startsWith('https://mockscreenshots.com/fake-whatsapp-chat-generator?s='));
});

test('buildRenderUrl targets /api/render with platform+s (+scale)', () => {
  assert.ok(buildRenderUrl('imessage', state).startsWith('https://mockscreenshots.com/api/render?platform=imessage&s='));
  assert.match(buildRenderUrl('imessage', state, 1), /&scale=1$/);
});

test('stdio MCP preserves incoming and outgoing mixed text plus PNG images for WhatsApp 1:1 and group links', async () => {
  await withStdioClient(async (client) => {
    const tools = await client.listTools();
    const generate = tools.tools.find((tool) => tool.name === 'generate_fake_chat');
    assert.ok(generate.inputSchema.properties.messages.items.properties.image);
    const imageSchema = generate.inputSchema.properties.messages.items.properties.image;
    assert.match(imageSchema.description, /non-sensitive.*synthetic.*public/i);
    assert.match(imageSchema.description, /URL.*sensitive/i);

    for (const platform of ['whatsapp', 'whatsapp-group']) {
      const result = await client.callTool({
        name: 'generate_fake_chat',
        arguments: {
          platform,
          contact: 'Jamie',
          status: 'online',
          device: 'iphone-16-pro',
          dark: false,
          format: 'link',
          messages: [
            {
              text: 'The launch moved to Friday. 🚀', sender: 'them', time: '09:41', author: 'Jamie',
              image: { data: PNG_BASE64, mimeType: 'image/png', alt: 'Synthetic launch board' },
            },
            {
              text: "Got it — I'll update the brief.", sender: 'me', time: '09:42', ticks: 'read',
              image: { data: PNG_BASE64, mimeType: 'image/png', alt: 'Synthetic launch board' },
            },
          ],
        },
      });
      assert.equal(result.isError, undefined);
      const text = result.content[0].text;
      assert.match(text, /watermarked/i);
      assert.match(text, /do not present it as real/i);
      assert.match(text, /attachment bytes.*URL/i);
      assert.match(text, /non-sensitive.*synthetic.*public/i);
      assert.match(text, /URL.*sensitive/i);
      const editUrl = text.match(/Edit in the generator: (\S+)/)?.[1];
      const decoded = decodeStateFromUrl(editUrl);
      assert.deepEqual(decoded.m.map((message) => message.im), [
        { src: `data:image/png;base64,${PNG_BASE64}`, alt: 'Synthetic launch board' },
        { src: `data:image/png;base64,${PNG_BASE64}`, alt: 'Synthetic launch board' },
      ]);
      assert.deepEqual(decoded.m.map((message) => message.s), ['them', 'me']);
    }
  });
});

test('tool schema allows image-only WhatsApp messages while preserving text-only inputs', async () => {
  await withStdioClient(async (client) => {
    const tools = await client.listTools();
    const messageSchema = tools.tools.find((tool) => tool.name === 'generate_fake_chat')
      .inputSchema.properties.messages.items;
    assert.deepEqual(messageSchema.required, ['sender']);

    const textOnly = await client.callTool({
      name: 'generate_fake_chat',
      arguments: {
        platform: 'whatsapp', format: 'link',
        messages: [{ text: 'Existing text-only behavior', sender: 'them', time: '09:41' }],
      },
    });
    assert.equal(textOnly.isError, undefined);
    const editUrl = textOnly.content[0].text.match(/Edit in the generator: (\S+)/)?.[1];
    assert.deepEqual(decodeStateFromUrl(editUrl).m, [{ t: 'Existing text-only behavior', s: 'them', ti: '09:41' }]);
  });
});

test('stdio MCP returns inline PNG plus deterministic hosted and edit URLs for an image message', async () => {
  await withRenderServer((req, res) => {
    assert.match(req.url, /^\/api\/render\?platform=whatsapp&s=.*&scale=1$/);
    assert.match(req.headers['cache-control'] ?? '', /no-cache/i);
    assert.equal(req.headers.referer, undefined);
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(Buffer.from(PNG_BASE64, 'base64'));
  }, async (site) => {
    await withStdioClient(async (client) => {
      const args = {
        platform: 'whatsapp',
        contact: 'Jamie',
        messages: [{ sender: 'them', image: { data: PNG_BASE64, mimeType: 'image/png', alt: 'Synthetic launch board' } }],
      };
      const first = await client.callTool({ name: 'generate_fake_chat', arguments: args });
      const second = await client.callTool({ name: 'generate_fake_chat', arguments: args });
      for (const result of [first, second]) {
        assert.equal(result.isError, undefined);
        assert.deepEqual(result.content[0], { type: 'image', mimeType: 'image/png', data: PNG_BASE64 });
        assert.match(result.content[1].text, new RegExp(`Full-res \\(download/share\\): ${site.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/api\\/render\\?`));
        assert.match(result.content[1].text, new RegExp(`Edit: ${site.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/fake-whatsapp-chat-generator\\?s=`));
        assert.match(result.content[1].text, /watermarked/i);
        assert.match(result.content[1].text, /attachment bytes.*URL/i);
        assert.match(result.content[1].text, /URL.*sensitive/i);
      }
      assert.equal(first.content[1].text, second.content[1].text);
    }, { MOCKSCREENSHOTS_SITE: site });
  });
});

test('stdio MCP gracefully falls back to watermarked links on render endpoint failures and timeouts', async () => {
  for (const mode of ['failure', 'timeout']) {
    await withRenderServer((_req, res) => {
      if (mode === 'failure') {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end('{"error":"unavailable"}');
        return;
      }
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'image/png' });
        res.end(Buffer.from(PNG_BASE64, 'base64'));
      }, 100);
    }, async (site) => {
      await withStdioClient(async (client) => {
        const result = await client.callTool({
          name: 'generate_fake_chat',
          arguments: {
            platform: 'whatsapp',
            messages: [{ text: 'Safe fallback', sender: 'them', image: { data: PNG_BASE64, mimeType: 'image/png' } }],
          },
        });
        assert.equal(result.isError, undefined, mode);
        assert.equal(result.content.length, 1, mode);
        assert.equal(result.content[0].type, 'text', mode);
        assert.match(result.content[0].text, /preview unavailable/i, mode);
        assert.match(result.content[0].text, /Image: http:\/\/127\.0\.0\.1:/, mode);
        assert.match(result.content[0].text, /Edit: http:\/\/127\.0\.0\.1:/, mode);
        assert.match(result.content[0].text, /watermarked/i, mode);
        assert.match(result.content[0].text, /attachment bytes.*URL/i, mode);
        assert.match(result.content[0].text, /URL.*sensitive/i, mode);
        if (mode === 'failure') assert.match(result.content[0].text, /render 503/i);
        if (mode === 'timeout') assert.match(result.content[0].text, /timed out|timeout|aborted/i);
      }, { MOCKSCREENSHOTS_SITE: site, MOCKSCREENSHOTS_RENDER_TIMEOUT_MS: mode === 'failure' ? '500' : '20' });
    });
  }
});

test('stdio MCP rejects non-PNG and oversized preview responses without returning unsafe inline content', async () => {
  const cases = [
    { label: 'wrong content type', headers: { 'content-type': 'text/html' }, body: Buffer.from('<script>alert(1)</script>'), expected: /content type/i },
    { label: 'oversized response', headers: { 'content-type': 'image/png' }, body: Buffer.alloc((10 * 1024 * 1024) + 1), expected: /too large/i },
  ];
  for (const fixture of cases) {
    await withRenderServer((_req, res) => {
      res.writeHead(200, { ...fixture.headers, 'content-length': fixture.body.length });
      res.end(fixture.body);
    }, async (site) => {
      await withStdioClient(async (client) => {
        const result = await client.callTool({
          name: 'generate_fake_chat',
          arguments: { platform: 'whatsapp', messages: [{ text: 'Safe', sender: 'them' }] },
        });
        assert.equal(result.content.length, 1, fixture.label);
        assert.equal(result.content[0].type, 'text', fixture.label);
        assert.match(result.content[0].text, fixture.expected, fixture.label);
        assert.match(result.content[0].text, /watermarked/i, fixture.label);
      }, { MOCKSCREENSHOTS_SITE: site, MOCKSCREENSHOTS_RENDER_TIMEOUT_MS: '500' });
    });
  }
});

test('stdio MCP cancels an oversized chunked preview without Content-Length and safely falls back', async () => {
  let responseClosed = false;
  let chunksWritten = 0;
  await withRenderServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'image/png' });
    res.on('close', () => { responseClosed = true; });
    const chunk = Buffer.alloc(1024 * 1024);
    chunk.set(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const timer = setInterval(() => {
      if (chunksWritten >= 20) {
        clearInterval(timer);
        res.end();
        return;
      }
      chunksWritten += 1;
      res.write(chunk);
    }, 50);
    res.on('error', () => clearInterval(timer));
    res.on('close', () => clearInterval(timer));
  }, async (site) => {
    await withStdioClient(async (client) => {
      const result = await client.callTool({
        name: 'generate_fake_chat',
        arguments: { platform: 'whatsapp', messages: [{ text: 'Safe', sender: 'them' }] },
      });
      assert.equal(result.content.length, 1);
      assert.equal(result.content[0].type, 'text');
      assert.match(result.content[0].text, /too large/i);
      assert.match(result.content[0].text, /watermarked/i);
    }, { MOCKSCREENSHOTS_SITE: site, MOCKSCREENSHOTS_RENDER_TIMEOUT_MS: '2000' });
  });
  assert.equal(responseClosed, true);
  assert.ok(chunksWritten < 20, `expected reader cancellation before all chunks, wrote ${chunksWritten}`);
});

test('stdio MCP safely rejects a preview with a deceptive Content-Length', async () => {
  await withRenderServer((_req, res) => {
    const png = Buffer.from(PNG_BASE64, 'base64');
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': png.length + 1 });
    res.end(png);
  }, async (site) => {
    await withStdioClient(async (client) => {
      const result = await client.callTool({
        name: 'generate_fake_chat',
        arguments: { platform: 'whatsapp', messages: [{ text: 'Safe', sender: 'them' }] },
      });
      assert.equal(result.content.length, 1);
      assert.equal(result.content[0].type, 'text');
      assert.match(result.content[0].text, /preview unavailable/i);
      assert.match(result.content[0].text, /terminated|aborted|body/i);
      assert.match(result.content[0].text, /watermarked/i);
    }, { MOCKSCREENSHOTS_SITE: site, MOCKSCREENSHOTS_RENDER_TIMEOUT_MS: '2000' });
  });
});

test('stdio MCP applies cheap message, field, and aggregate attachment limits before render-state encoding', async () => {
  await withStdioClient(async (client) => {
    const tinyPng = { data: PNG_BASE64, mimeType: 'image/png' };
    const cases = [
      {
        label: 'message count',
        arguments: {
          platform: 'whatsapp', format: 'link',
          messages: Array.from({ length: 101 }, () => ({ text: 'x', sender: 'them' })),
        },
        expected: /100 messages or fewer/i,
      },
      {
        label: 'oversized message text',
        arguments: {
          platform: 'whatsapp', format: 'link',
          messages: [{ text: 'x'.repeat(4001), sender: 'them' }],
        },
        expected: /message text.*4000/i,
      },
      {
        label: 'oversized contact metadata',
        arguments: {
          platform: 'whatsapp', format: 'link', contact: 'x'.repeat(257),
          messages: [{ text: 'safe', sender: 'them' }],
        },
        expected: /contact.*256/i,
      },
      {
        label: 'oversized image alternative text',
        arguments: {
          platform: 'whatsapp', format: 'link',
          messages: [{ sender: 'them', image: { ...tinyPng, alt: 'x'.repeat(161) } }],
        },
        expected: /alternative text.*160/i,
      },
      {
        label: 'aggregate message text',
        arguments: {
          platform: 'whatsapp', format: 'link',
          messages: [
            { text: 'x'.repeat(3500), sender: 'them' },
            { text: 'y'.repeat(3500), sender: 'me' },
          ],
        },
        expected: /combined message text.*too large/i,
      },
      {
        label: 'aggregate attachments',
        arguments: {
          platform: 'whatsapp', format: 'link',
          messages: Array.from({ length: 66 }, () => ({ sender: 'them', image: tinyPng })),
        },
        expected: /combined image data.*too large/i,
      },
    ];

    for (const fixture of cases) {
      const result = await client.callTool({ name: 'generate_fake_chat', arguments: fixture.arguments });
      assert.equal(result.isError, true, fixture.label);
      assert.match(result.content[0].text, fixture.expected, fixture.label);
      assert.match(result.content[0].text, /watermarked/i, fixture.label);
    }
  });
});

test('stdio MCP rejects unsafe, unsupported, missing, oversized, and endpoint-incompatible image inputs with isError', async () => {
  await withStdioClient(async (client) => {
    const invalidCases = [
      {
        label: 'null message',
        arguments: { platform: 'whatsapp', messages: [null], format: 'link' },
        expected: /message must be an object/i,
      },
      {
        label: 'missing sender',
        arguments: { platform: 'whatsapp', messages: [{ text: 'No sender' }], format: 'link' },
        expected: /sender.*me.*them/i,
      },
      {
        label: 'invalid sender',
        arguments: { platform: 'whatsapp', messages: [{ text: 'Bad sender', sender: 'remote' }], format: 'link' },
        expected: /sender.*me.*them/i,
      },
      {
        label: 'missing image bytes',
        arguments: { platform: 'whatsapp', messages: [{ sender: 'them', image: { mimeType: 'image/png' } }], format: 'link' },
        expected: /image data/i,
      },
      {
        label: 'malformed base64',
        arguments: { platform: 'whatsapp', messages: [{ sender: 'them', image: { data: 'not base64!', mimeType: 'image/png' } }], format: 'link' },
        expected: /base64/i,
      },
      {
        label: 'remote image URL',
        arguments: { platform: 'whatsapp', messages: [{ sender: 'them', image: { data: 'https://example.com/private.png', mimeType: 'image/png' } }], format: 'link' },
        expected: /base64/i,
      },
      {
        label: 'spoofed PNG signature',
        arguments: { platform: 'whatsapp', messages: [{ sender: 'them', image: { data: Buffer.from('not a png').toString('base64'), mimeType: 'image/png' } }], format: 'link' },
        expected: /contents do not match/i,
      },
      {
        label: 'unsupported SVG',
        arguments: { platform: 'whatsapp', messages: [{ sender: 'them', image: { data: 'PHN2Zz48L3N2Zz4=', mimeType: 'image/svg+xml' } }], format: 'link' },
        expected: /PNG, JPEG, or WebP/i,
      },
      {
        label: 'image on unsupported platform',
        arguments: { platform: 'imessage', messages: [{ sender: 'them', image: { data: PNG_BASE64, mimeType: 'image/png' } }], format: 'link' },
        expected: /only supported.*WhatsApp/i,
      },
      {
        label: 'oversized image',
        arguments: { platform: 'whatsapp', messages: [{ sender: 'them', image: { data: Buffer.alloc((2 * 1024 * 1024) + 1).toString('base64'), mimeType: 'image/png' } }], format: 'link' },
        expected: /2 MB or smaller/i,
      },
      {
        label: 'render-state URL limit',
        arguments: { platform: 'whatsapp', messages: [{ sender: 'them', image: { data: Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(6000)]).toString('base64'), mimeType: 'image/png' } }], format: 'link' },
        expected: /combined image data.*too large/i,
      },
    ];

    for (const { label, arguments: args, expected } of invalidCases) {
      const result = await client.callTool({ name: 'generate_fake_chat', arguments: args });
      assert.equal(result.isError, true, label);
      assert.match(result.content[0].text, expected, label);
      assert.match(result.content[0].text, /watermarked/i, label);
      assert.match(result.content[0].text, /ethics/i, label);
    }
  });
});

test('stdio handshake version matches package and registry metadata', async () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const registry = JSON.parse(readFileSync(new URL('../server.json', import.meta.url), 'utf8'));
  await withStdioClient(async (client) => {
    assert.equal(client.getServerVersion().version, pkg.version);
    assert.equal(registry.version, pkg.version);
    assert.equal(registry.packages[0].version, pkg.version);
  });
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
