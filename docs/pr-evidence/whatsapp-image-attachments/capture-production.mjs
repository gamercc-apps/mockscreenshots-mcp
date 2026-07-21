import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const evidenceDir = fileURLToPath(new URL('./', import.meta.url));
const serverPath = fileURLToPath(new URL('../../../server.mjs', import.meta.url));
const fixture = JSON.parse(await readFile(new URL('./request-fixture.json', import.meta.url), 'utf8'));
const imageBytes = await readFile(new URL('./synthetic-launch-board.png', import.meta.url));
const imageData = imageBytes.toString('base64');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
if (sha256(imageBytes) !== fixture.attachment.sha256) throw new Error('synthetic fixture checksum mismatch');

const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath], stderr: 'pipe' });
const client = new Client({ name: 'mcp-pr-evidence-client', version: '1.0.0' });
const results = [];
try {
  await client.connect(transport);
  const tools = await client.listTools();
  for (const platform of fixture.input.platforms) {
    const startedAt = Date.now();
    const request = {
      platform,
      contact: fixture.input.contact,
      status: fixture.input.status,
      device: fixture.input.device,
      dark: fixture.input.dark,
      format: fixture.input.format,
      messages: fixture.input.messages.map((message) => ({
        ...message,
        image: { data: imageData, mimeType: message.image.mimeType, alt: message.image.alt },
      })),
    };
    const result = await client.callTool({ name: 'generate_fake_chat', arguments: request });
    const image = result.content.find((item) => item.type === 'image');
    const text = result.content.find((item) => item.type === 'text');
    if (result.isError || !image || !text) throw new Error(`${platform}: production call returned no inline image and text: ${text?.text ?? 'no text'}`);
    const preview = Buffer.from(image.data, 'base64');
    const previewPath = `previews/${platform}-watermarked.png`;
    await writeFile(new URL(`./${previewPath}`, import.meta.url), preview);
    results.push({
      platform,
      durationMs: Date.now() - startedAt,
      isError: false,
      contentTypes: result.content.map((item) => item.type),
      preview: { path: previewPath, mimeType: image.mimeType, bytes: preview.length, sha256: sha256(preview) },
      text: text.text,
    });
  }
  const manifest = {
    capturedAtUtc: new Date().toISOString(),
    transport: 'Client + StdioClientTransport',
    productionSite: 'https://mockscreenshots.com',
    serverVersion: client.getServerVersion(),
    toolNames: tools.tools.map((tool) => tool.name),
    attachment: { path: 'synthetic-launch-board.png', bytes: imageBytes.length, sha256: sha256(imageBytes) },
    results,
    guaranteesObserved: {
      inlineImageAndText: results.every((entry) => entry.contentTypes.join(',') === 'image,text'),
      hostedAndEditUrls: results.every((entry) => /Full-res \(download\/share\): https:\/\/mockscreenshots\.com\/api\/render\?/.test(entry.text) && /Edit: https:\/\/mockscreenshots\.com\/fake-whatsapp/.test(entry.text)),
      ethicsAndWatermarkText: results.every((entry) => /watermarked/.test(entry.text) && /do not present it as real/.test(entry.text)),
      deterministicInput: true
    }
  };
  await writeFile(new URL('./stdio-production-result.json', import.meta.url), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(manifest, null, 2));
} finally {
  await client.close();
}
