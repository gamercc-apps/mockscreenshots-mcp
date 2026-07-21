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

const attemptsPerPlatform = 2;
const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath], stderr: 'pipe' });
const client = new Client({ name: 'mcp-pr-evidence-client', version: '1.0.0' });
const attempts = [];
try {
  await client.connect(transport);
  const tools = await client.listTools();
  for (const platform of fixture.input.platforms) {
    for (let attempt = 1; attempt <= attemptsPerPlatform; attempt += 1) {
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
      const textValue = text?.text ?? '';
      const hasHostedAndEditUrls = /Full-res \(download\/share\): https:\/\/mockscreenshots\.com\/api\/render\?/.test(textValue)
        && /Edit: https:\/\/mockscreenshots\.com\/fake-whatsapp/.test(textValue);
      const ethicsAndWatermarkText = /watermarked/.test(textValue) && /do not present it as real/.test(textValue);
      let preview = null;
      if (image) {
        const previewBytes = Buffer.from(image.data, 'base64');
        const previewPath = `previews/${platform}-watermarked.png`;
        await writeFile(new URL(`./${previewPath}`, import.meta.url), previewBytes);
        preview = { path: previewPath, mimeType: image.mimeType, bytes: previewBytes.length, sha256: sha256(previewBytes) };
      }
      const outcome = image && text
        ? 'inline-image-and-text-success'
        : !image && text && hasHostedAndEditUrls
          ? 'text-link-fallback'
          : 'protocol-error';
      attempts.push({
        platform,
        attempt,
        durationMs: Date.now() - startedAt,
        isError: Boolean(result.isError),
        outcome,
        contentTypes: result.content.map((item) => item.type),
        preview,
        hasHostedAndEditUrls,
        ethicsAndWatermarkText,
        text: textValue,
      });
    }
  }
  const manifest = {
    capturedAtUtc: new Date().toISOString(),
    command: 'node docs/pr-evidence/whatsapp-image-attachments/capture-production.mjs',
    attemptsPerPlatform,
    transport: 'Client + StdioClientTransport',
    productionSite: 'https://mockscreenshots.com',
    reviewedSha: '02d6b8b5ef6d895486701aa7729af8a7bf7a13b8',
    serverVersion: client.getServerVersion(),
    toolNames: tools.tools.map((tool) => tool.name),
    attachment: { path: 'synthetic-launch-board.png', bytes: imageBytes.length, sha256: sha256(imageBytes) },
    attempts,
    currentRunSummary: {
      totalAttempts: attempts.length,
      inlineImageAndTextSuccesses: attempts.filter((entry) => entry.outcome === 'inline-image-and-text-success').length,
      textLinkFallbacks: attempts.filter((entry) => entry.outcome === 'text-link-fallback').length,
      protocolErrors: attempts.filter((entry) => entry.outcome === 'protocol-error').length,
      hostedAndEditUrlsOnEveryAttempt: attempts.every((entry) => entry.hasHostedAndEditUrls),
      ethicsAndWatermarkTextOnEveryAttempt: attempts.every((entry) => entry.ethicsAndWatermarkText),
    },
    historicalObservation: {
      source: 'release-review reruns reported in Kanban task t_ad00badf',
      platform: 'whatsapp-group',
      attempts: 2,
      endpointResult: 'HTTP 500',
      protocolOutcome: 'text-link-fallback',
      contentTypes: ['text'],
      retainedOutputs: ['hosted full-resolution URL', 'edit URL', 'fictional/watermarked ethics warning'],
      inlineImageReturned: false,
      note: 'These two failures are retained as operational evidence. Graceful fallback is not counted as inline image+text success; the current rerun below is recorded separately.',
    },
    deterministicInput: true,
  };
  await writeFile(new URL('./stdio-production-result.json', import.meta.url), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(manifest, null, 2));
} finally {
  await client.close();
}
