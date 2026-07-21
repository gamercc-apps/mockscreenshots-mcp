#!/usr/bin/env node
/**
 * Mock Screenshots MCP server.
 *
 * Exposes tools that let an AI agent compose a fake chat/screenshot and get back
 * a deep link to the matching Mock Screenshots generator, pre-filled and ready to
 * export. Honest by design: the tool returns a server-rendered, watermarked PNG
 * (inline preview + hosted URL from the site's /api/render endpoint) alongside a
 * deep link the user can open to preview, tweak and download.
 *
 * Distribution: publish to registry.modelcontextprotocol.io, then mcp.so,
 * Smithery, PulseMCP, Glama, awesome-mcp-servers (ACTION-PLAN §4).
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { fileURLToPath } from 'node:url';
import { readFileSync, realpathSync } from 'node:fs';

const SITE = process.env.MOCKSCREENSHOTS_SITE || 'https://mockscreenshots.com';
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 10 * 1024 * 1024;
const MAX_RENDER_STATE_LENGTH = 8000;
const MAX_MESSAGES = 100;
const MAX_MESSAGE_TEXT_LENGTH = 4000;
const MAX_METADATA_LENGTH = 256;
const MAX_TIME_LENGTH = 64;
const MAX_ALT_LENGTH = 160;
const MAX_ENUM_FIELD_LENGTH = 16;
// A base64url string is at least 4/3 the size of its JSON input. Requests
// beyond 6,000 source bytes cannot fit the deployed 8,000-character state.
const MAX_AGGREGATE_SOURCE_BYTES = 6000;
const configuredRenderTimeout = Number(process.env.MOCKSCREENSHOTS_RENDER_TIMEOUT_MS);
const RENDER_TIMEOUT_MS = Number.isFinite(configuredRenderTimeout)
  ? Math.min(30000, Math.max(10, Math.round(configuredRenderTimeout)))
  : 30000;
const SAFE_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const PACKAGE_VERSION = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

// platform → generator slug. Keep in sync with src/config/tools.ts.
const PLATFORMS = {
  imessage: '/fake-imessage-generator',
  whatsapp: '/fake-whatsapp-chat-generator',
  'whatsapp-group': '/fake-whatsapp-group-chat-generator',
  instagram: '/fake-instagram-chat-generator',
  telegram: '/fake-telegram-chat-generator',
  messenger: '/fake-messenger-chat-generator',
  snapchat: '/fake-snapchat-generator',
};

// device ids the generators accept. Keep in sync with src/lib/devices.ts.
const DEVICES = [
  'iphone-16-pro', 'iphone-16', 'iphone-15-pro', 'iphone-15', 'iphone-14', 'iphone-13', 'iphone-se',
  'pixel-8-pro', 'pixel-8', 'galaxy-s24-ultra', 'galaxy-s24',
];

const b64urlEncode = (str) =>
  Buffer.from(str, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const ethicsWarning = () =>
  `Output is clearly fictional and watermarked — do not present it as real. See ${SITE}/ethics.`;

const attachmentPrivacyWarning = () =>
  'Privacy: Attachment bytes are embedded in the hosted image and edit URLs. Use only non-sensitive synthetic or public attachments, and treat every attachment URL as sensitive because it may be retained in MCP transcripts, client/browser history, proxy/CDN logs, analytics/referrers, and cache keys.';

const errorResult = (message) => ({
  isError: true,
  content: [{ type: 'text', text: `${message}\n\n${ethicsWarning()}` }],
});

function boundedStringBytes(value, label, maxLength) {
  if (value === undefined || value === null || value === '') return { bytes: 0 };
  if (typeof value !== 'string') return { error: `${label} must be a string.` };
  if (value.length > maxLength) return { error: `${label} must be ${maxLength} characters or fewer.` };
  return { bytes: Buffer.byteLength(value, 'utf8') };
}

async function readBoundedPreview(resp) {
  if (!resp.body) throw new Error('rendered preview is empty');
  const reader = resp.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_PREVIEW_BYTES) {
        await reader.cancel('rendered preview is too large').catch(() => {});
        throw new Error('rendered preview is too large');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) throw new Error('rendered preview is too large');
  return Buffer.concat(chunks, total);
}

function validateImage(image, platform) {
  if (!image || typeof image !== 'object') return { error: 'Image data is required.' };
  if (platform !== 'whatsapp' && platform !== 'whatsapp-group') {
    return { error: 'Static image attachments are only supported for WhatsApp 1:1 and group chats.' };
  }
  if (typeof image.data !== 'string' || image.data.length === 0) return { error: 'Image data is required.' };
  if (!SAFE_IMAGE_MIMES.has(image.mimeType)) return { error: 'Choose a PNG, JPEG, or WebP image. SVG is not supported.' };
  if (image.data.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(image.data)) {
    return { error: 'Image data must be valid base64.' };
  }
  if (image.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) {
    return { error: 'The image must be 2 MB or smaller.' };
  }
  const bytes = Buffer.from(image.data, 'base64');
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return { error: 'The image must be 2 MB or smaller.' };
  if (bytes.toString('base64').replace(/=+$/, '') !== image.data.replace(/=+$/, '')) {
    return { error: 'Image data must be valid base64.' };
  }
  const signatureMatches = image.mimeType === 'image/png'
    ? bytes.length >= 8 && Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).equals(bytes.subarray(0, 8))
    : image.mimeType === 'image/jpeg'
      ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!signatureMatches) return { error: `Image contents do not match ${image.mimeType}.` };
  const alt = typeof image.alt === 'string' ? image.alt.trim().slice(0, 160) : '';
  return {
    value: {
      src: `data:${image.mimeType};base64,${image.data}`,
      alt: alt || 'Attached image',
    },
  };
}

/** Build a deep link to the generator, pre-filled with the compact share state. */
export function buildDeepLink(platform, state) {
  const slug = PLATFORMS[platform];
  return `${SITE}${slug}?s=${b64urlEncode(JSON.stringify(state))}`;
}

/** Build a render-endpoint URL for the given platform + state. `scale=1` = low-res preview; omitted = full-res. */
export function buildRenderUrl(platform, state, scale) {
  const s = b64urlEncode(JSON.stringify(state));
  const q = `platform=${platform}&s=${s}` + (scale ? `&scale=${scale}` : '');
  return `${SITE}/api/render?${q}`;
}

const server = new Server(
  { name: 'mockscreenshots', version: PACKAGE_VERSION },
  { capabilities: { tools: {} } },
);

const TOOLS = [
  {
    name: 'generate_fake_chat',
    description:
      'Compose a fake chat screenshot (iMessage, WhatsApp, Instagram DM, Telegram, Messenger, Snapchat) and get a deep link to the Mock Screenshots generator, pre-filled and ready to preview and download. Output is watermarked and clearly fictional; intended for parody, education, design mockups and fiction — not deception.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: Object.keys(PLATFORMS), description: 'Which chat app to mimic.' },
        messages: {
          type: 'array',
          maxItems: MAX_MESSAGES,
          description: 'The conversation, in order.',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string', maxLength: MAX_MESSAGE_TEXT_LENGTH },
              sender: { type: 'string', enum: ['me', 'them'], description: '"me" = the phone owner (right side).' },
              time: { type: 'string', maxLength: MAX_TIME_LENGTH, description: 'Optional timestamp, e.g. "20:14".' },
              ticks: { type: 'string', enum: ['sent', 'delivered', 'read'], description: 'WhatsApp/Telegram outgoing ticks.' },
              author: { type: 'string', maxLength: MAX_METADATA_LENGTH, description: 'Sender name for group chats (incoming only).' },
              service: { type: 'string', enum: ['imessage', 'sms'], description: 'iMessage blue vs SMS green.' },
              image: {
                type: 'object',
                description: 'Optional static image attachment for WhatsApp chats. Use only non-sensitive synthetic or public data. Attachment bytes are embedded in returned URLs; treat every attachment URL as sensitive.',
                properties: {
                  data: { type: 'string', description: 'Base64-encoded PNG, JPEG, or WebP bytes.' },
                  mimeType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp'] },
                  alt: { type: 'string', maxLength: 160, description: 'Accessible image description.' },
                },
                required: ['data', 'mimeType'],
                additionalProperties: false,
              },
            },
            required: ['sender'],
          },
        },
        contact: { type: 'string', maxLength: MAX_METADATA_LENGTH, description: 'Contact name, username or group name shown in the header.' },
        status: { type: 'string', maxLength: MAX_METADATA_LENGTH, description: 'Header status line, e.g. "online", "Active now", "typing…".' },
        device: { type: 'string', enum: DEVICES, description: 'Device frame. Defaults to iphone-16-pro.' },
        dark: { type: 'boolean', description: 'Dark mode. Defaults to false.' },
        format: { type: 'string', enum: ['image', 'link'], description: 'Return an inline preview image (default) or just links.' },
      },
      required: ['platform', 'messages'],
    },
  },
  {
    name: 'list_platforms',
    description: 'List the chat platforms this server can generate, with their generator URLs.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_devices',
    description: 'List the device frames (iPhone and Android) the generators support.',
    inputSchema: { type: 'object', properties: {} },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;

  if (name === 'list_platforms') {
    const lines = Object.entries(PLATFORMS).map(([p, slug]) => `- ${p}: ${SITE}${slug}`);
    return { content: [{ type: 'text', text: `Available platforms:\n${lines.join('\n')}` }] };
  }

  if (name === 'list_devices') {
    return { content: [{ type: 'text', text: `Supported devices:\n${DEVICES.map((d) => `- ${d}`).join('\n')}` }] };
  }

  if (name === 'generate_fake_chat') {
    const { platform, messages, contact, status, device, dark } = args;
    if (!PLATFORMS[platform]) return errorResult(`Unknown platform "${platform}". Use list_platforms.`);
    if (!Array.isArray(messages) || messages.length === 0) {
      return errorResult('Provide at least one message.');
    }
    if (messages.length > MAX_MESSAGES) {
      return errorResult(`Provide ${MAX_MESSAGES} messages or fewer.`);
    }
    if (device && !DEVICES.includes(device)) {
      return errorResult(`Unknown device "${device}". Use list_devices.`);
    }

    let aggregateSourceBytes = 0;
    let aggregateImageChars = 0;
    for (const [value, label, maxLength] of [
      [contact, 'Contact', MAX_METADATA_LENGTH],
      [status, 'Status', MAX_METADATA_LENGTH],
    ]) {
      const checked = boundedStringBytes(value, label, maxLength);
      if (checked.error) return errorResult(checked.error);
      aggregateSourceBytes += checked.bytes;
    }

    const normalizedImages = [];
    for (const message of messages) {
      if (!message || typeof message !== 'object' || Array.isArray(message)) {
        return errorResult('Each message must be an object.');
      }
      if (message.sender !== 'me' && message.sender !== 'them') {
        return errorResult('Each message sender must be "me" or "them".');
      }
      if ((typeof message.text !== 'string' || message.text.length === 0) && !message.image) {
        return errorResult('Each message must include text or an image attachment.');
      }
      for (const [value, label, maxLength] of [
        [message.text, 'Message text', MAX_MESSAGE_TEXT_LENGTH],
        [message.time, 'Message time', MAX_TIME_LENGTH],
        [message.author, 'Message author', MAX_METADATA_LENGTH],
        [message.ticks, 'Message ticks', MAX_ENUM_FIELD_LENGTH],
        [message.service, 'Message service', MAX_ENUM_FIELD_LENGTH],
      ]) {
        const bounded = boundedStringBytes(value, label, maxLength);
        if (bounded.error) return errorResult(bounded.error);
        aggregateSourceBytes += bounded.bytes;
      }
      if (!message.image) {
        if (aggregateSourceBytes > MAX_AGGREGATE_SOURCE_BYTES) {
          return errorResult('The combined message text and metadata are too large for the production endpoint.');
        }
        normalizedImages.push(null);
        continue;
      }
      const boundedAlt = boundedStringBytes(message.image.alt, 'Image alternative text', MAX_ALT_LENGTH);
      if (boundedAlt.error) return errorResult(boundedAlt.error);
      aggregateSourceBytes += boundedAlt.bytes;
      if (typeof message.image.data === 'string') {
        const padding = message.image.data.endsWith('==') ? 2 : message.image.data.endsWith('=') ? 1 : 0;
        const estimatedBytes = Math.floor(message.image.data.length * 3 / 4) - padding;
        if (estimatedBytes > MAX_IMAGE_BYTES) {
          return errorResult('The image must be 2 MB or smaller.');
        }
        aggregateImageChars += message.image.data.length;
        aggregateSourceBytes += message.image.data.length;
        if (aggregateImageChars > MAX_AGGREGATE_SOURCE_BYTES) {
          return errorResult('The combined image data is too large for the production endpoint.');
        }
        if (aggregateSourceBytes > MAX_AGGREGATE_SOURCE_BYTES) {
          return errorResult('The combined request data is too large for the production endpoint.');
        }
      }
      const checked = validateImage(message.image, platform);
      if (checked.error) return errorResult(checked.error);
      normalizedImages.push(checked.value);
    }

    const state = {
      ...(device ? { d: device } : {}),
      ...(typeof dark === 'boolean' ? { dark } : {}),
      ...(contact ? { c: contact } : {}),
      ...(status ? { st: status } : {}),
      m: messages.map((m, index) => ({
        t: String(m.text ?? ''),
        s: m.sender === 'them' ? 'them' : 'me',
        ...(m.time ? { ti: m.time } : {}),
        ...(m.ticks ? { tk: m.ticks } : {}),
        ...(m.author ? { a: m.author } : {}),
        ...(m.service ? { sv: m.service } : {}),
        ...(normalizedImages[index] ? { im: normalizedImages[index] } : {}),
      })),
    };

    if (b64urlEncode(JSON.stringify(state)).length > MAX_RENDER_STATE_LENGTH) {
      return errorResult('The encoded render state is too large for the production endpoint. Use a smaller image or shorter conversation.');
    }

    const deepLink = buildDeepLink(platform, state);
    const fullUrl = buildRenderUrl(platform, state);          // full-res, download/share
    const ethics = ethicsWarning();
    const privacy = normalizedImages.some(Boolean) ? `\n\n${attachmentPrivacyWarning()}` : '';

    if (args.format === 'link') {
      return { content: [{ type: 'text', text:
        `Fake ${platform} chat ready.\nImage (download/share): ${fullUrl}\nEdit in the generator: ${deepLink}\n\n${ethics}${privacy}` }] };
    }

    // Default: inline preview image + links. Preview is low-res (scale=1) to
    // keep tokens down; fullUrl is retina.
    try {
      const previewUrl = buildRenderUrl(platform, state, 1);
      const resp = await fetch(previewUrl, {
        signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
      if (!resp.ok) {
        await resp.body?.cancel().catch(() => {});
        throw new Error(`render ${resp.status}`);
      }
      if (resp.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'image/png') {
        await resp.body?.cancel().catch(() => {});
        throw new Error('render returned an invalid content type');
      }
      const contentLength = resp.headers.get('content-length');
      if (contentLength !== null && !/^\d+$/.test(contentLength)) {
        await resp.body?.cancel().catch(() => {});
        throw new Error('render returned an invalid content length');
      }
      const declaredLength = contentLength === null ? null : Number(contentLength);
      if (declaredLength !== null && declaredLength > MAX_PREVIEW_BYTES) {
        await resp.body?.cancel().catch(() => {});
        throw new Error('rendered preview is too large');
      }
      const buf = await readBoundedPreview(resp);
      if (!Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).equals(buf.subarray(0, 8))) {
        throw new Error('render returned invalid PNG data');
      }
      return { content: [
        { type: 'image', mimeType: 'image/png', data: buf.toString('base64') },
        { type: 'text', text:
          `Fake ${platform} chat.\nFull-res (download/share): ${fullUrl}\nEdit: ${deepLink}\n\n${ethics}${privacy}` },
      ] };
    } catch (e) {
      // Fidelity over failure: fall back to links if the render service is down.
      return { content: [{ type: 'text', text:
        `Fake ${platform} chat ready (preview unavailable: ${e.message}).\nImage: ${fullUrl}\nEdit: ${deepLink}\n\n${ethics}${privacy}` }] };
    }
  }

  return { isError: true, content: [{ type: 'text', text: `Unknown tool "${name}".` }] };
});

const isMain = process.argv[1] &&
  realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
if (isMain) {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('mockscreenshots-mcp running on stdio');
}
