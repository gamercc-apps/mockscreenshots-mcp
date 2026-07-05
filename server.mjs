#!/usr/bin/env node
/**
 * Mock Screenshots MCP server.
 *
 * Exposes tools that let an AI agent compose a fake chat/screenshot and get back
 * a deep link to the matching Mock Screenshots generator, pre-filled and ready to
 * export. Honest by design: it does not claim to render an image server-side —
 * it returns a URL the user opens to preview, tweak and download (watermarked).
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

const SITE = 'https://mockscreenshots.com';

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

/** Build a deep link for a platform + compact share state. */
function buildUrl(platform, state) {
  const slug = PLATFORMS[platform];
  const s = b64urlEncode(JSON.stringify(state));
  return `${SITE}${slug}?s=${s}`;
}

const server = new Server(
  { name: 'mockscreenshots', version: '0.1.0' },
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
          description: 'The conversation, in order.',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              sender: { type: 'string', enum: ['me', 'them'], description: '"me" = the phone owner (right side).' },
              time: { type: 'string', description: 'Optional timestamp, e.g. "20:14".' },
              ticks: { type: 'string', enum: ['sent', 'delivered', 'read'], description: 'WhatsApp/Telegram outgoing ticks.' },
              author: { type: 'string', description: 'Sender name for group chats (incoming only).' },
              service: { type: 'string', enum: ['imessage', 'sms'], description: 'iMessage blue vs SMS green.' },
            },
            required: ['text', 'sender'],
          },
        },
        contact: { type: 'string', description: 'Contact name, username or group name shown in the header.' },
        status: { type: 'string', description: 'Header status line, e.g. "online", "Active now", "typing…".' },
        device: { type: 'string', enum: DEVICES, description: 'Device frame. Defaults to iphone-16-pro.' },
        dark: { type: 'boolean', description: 'Dark mode. Defaults to false.' },
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
    if (!PLATFORMS[platform]) {
      return { isError: true, content: [{ type: 'text', text: `Unknown platform "${platform}". Use list_platforms.` }] };
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      return { isError: true, content: [{ type: 'text', text: 'Provide at least one message.' }] };
    }
    if (device && !DEVICES.includes(device)) {
      return { isError: true, content: [{ type: 'text', text: `Unknown device "${device}". Use list_devices.` }] };
    }

    const state = {
      ...(device ? { d: device } : {}),
      ...(typeof dark === 'boolean' ? { dark } : {}),
      ...(contact ? { c: contact } : {}),
      ...(status ? { st: status } : {}),
      m: messages.map((m) => ({
        t: String(m.text ?? ''),
        s: m.sender === 'them' ? 'them' : 'me',
        ...(m.time ? { ti: m.time } : {}),
        ...(m.ticks ? { tk: m.ticks } : {}),
        ...(m.author ? { a: m.author } : {}),
        ...(m.service ? { sv: m.service } : {}),
      })),
    };

    const url = buildUrl(platform, state);
    return {
      content: [
        {
          type: 'text',
          text:
            `Fake ${platform} chat ready. Open this link to preview and download (watermarked, free):\n\n${url}\n\n` +
            `Note: output is clearly fictional and watermarked. Do not present it as a real conversation — see ${SITE}/ethics.`,
        },
      ],
    };
  }

  return { isError: true, content: [{ type: 'text', text: `Unknown tool "${name}".` }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('mockscreenshots-mcp running on stdio');
