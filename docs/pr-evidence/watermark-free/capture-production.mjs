import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const evidenceDir = fileURLToPath(new URL('./', import.meta.url));
const outputDir = fileURLToPath(new URL('./outputs/', import.meta.url));
const serverPath = fileURLToPath(new URL('../../../server.mjs', import.meta.url));
const packagePath = fileURLToPath(new URL('../../../package.json', import.meta.url));
const attachmentPath = fileURLToPath(new URL('../whatsapp-image-attachments/synthetic-launch-board.png', import.meta.url));
const platforms = ['imessage', 'whatsapp', 'whatsapp-group', 'instagram', 'telegram', 'messenger', 'snapchat'];
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const forbiddenResponseClaim = /watermarked|watermark(?!-free)|FAKE watermark/i;
const forbiddenPixelText = /mockscreenshots\.com|\bFAKE\b/i;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
const attachment = await readFile(attachmentPath);
const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dirname(packagePath), encoding: 'utf8' }).trim();
const workingTreeDirty = execFileSync('git', ['status', '--porcelain'], { cwd: dirname(packagePath), encoding: 'utf8' }).trim().length > 0;

function extractUrls(text) {
  const hosted = text.match(/(?:Full-res \(download\/share\)|Image \(download\/share\)|Image): (https:\/\/mockscreenshots\.com\/api\/render\?[^\n]+)/)?.[1];
  const edit = text.match(/(?:Edit in the generator|Edit): (https:\/\/mockscreenshots\.com\/[^\s]+)/)?.[1];
  return { hosted, edit };
}

function summarizeUrl(value) {
  if (!value) return null;
  const url = new URL(value);
  return `${url.origin}${url.pathname}?${url.searchParams.has('platform') ? `platform=${url.searchParams.get('platform')}&` : ''}s=<redacted-synthetic-state>`;
}

function runOcr(path) {
  try {
    const text = execFileSync('tesseract', [path, 'stdout'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { available: true, forbiddenPixelTextFound: forbiddenPixelText.test(text), text };
  } catch (error) {
    if (error.code === 'ENOENT') return { available: false, forbiddenPixelTextFound: null, text: null };
    return { available: true, forbiddenPixelTextFound: null, text: null, error: error.message };
  }
}

async function inspectPng(bytes, outputName) {
  const path = `${outputDir}/${outputName}`;
  await writeFile(path, bytes);
  return {
    path: `outputs/${outputName}`,
    bytes: bytes.length,
    sha256: sha256(bytes),
    pngSignature: bytes.subarray(0, pngSignature.length).equals(pngSignature),
    ocr: runOcr(path),
  };
}

async function probeHosted(url, outputName) {
  const attempts = [];
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const startedAt = Date.now();
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        signal: AbortSignal.timeout(30000),
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get('content-type');
      const validPng = response.status === 200
        && contentType?.startsWith('image/png')
        && bytes.subarray(0, pngSignature.length).equals(pngSignature);
      const record = {
        attempt,
        durationMs: Date.now() - startedAt,
        status: response.status,
        contentType,
        bytes: bytes.length,
        bodySha256: sha256(bytes),
      };
      attempts.push(record);
      if (validPng) {
        return {
          ...record,
          cacheControl: response.headers.get('cache-control'),
          xRobotsTag: response.headers.get('x-robots-tag'),
          attempts,
          image: await inspectPng(bytes, outputName),
        };
      }
      if (attempt < 4) await delay(response.status === 429 ? 65000 : 3000);
    } catch (error) {
      attempts.push({
        attempt,
        durationMs: Date.now() - startedAt,
        errorName: error.name,
        errorMessage: error.message,
      });
      if (attempt < 4) await delay(3000);
    }
  }
  return { ...attempts.at(-1), attempts, image: null };
}

async function callToolWithPreviewRetry(arguments_) {
  const attempts = [];
  const startedAt = Date.now();
  const result = await client.callTool({ name: 'generate_fake_chat', arguments: arguments_ });
  attempts.push({ attempt: 1, durationMs: Date.now() - startedAt, contentTypes: result.content.map((item) => item.type) });
  return { result, attempts };
}

const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath], stderr: 'pipe' });
const client = new Client({ name: 'watermark-free-production-evidence', version: '1.0.0' });
const cases = [];
let productionImageCases = 0;
try {
  await client.connect(transport);
  const tools = await client.listTools();
  const generate = tools.tools.find((tool) => tool.name === 'generate_fake_chat');
  for (const platform of platforms) {
    for (const format of ['image', 'link']) {
      const arguments_ = {
        platform,
        format,
        contact: 'Jamie',
        messages: [{ text: `Fictional ${platform} launch mock`, sender: 'them', time: '09:41' }],
      };
      const startedAt = Date.now();
      const called = await callToolWithPreviewRetry(arguments_);
      const result = called.result;
      const text = result.content.find((item) => item.type === 'text')?.text ?? '';
      const image = result.content.find((item) => item.type === 'image');
      const urls = extractUrls(text);
      const record = {
        id: `${platform}-${format}-text-only`,
        platform,
        format,
        attachment: false,
        durationMs: Date.now() - startedAt,
        protocolAttempts: called.attempts,
        isError: Boolean(result.isError),
        contentTypes: result.content.map((item) => item.type),
        fictionalGuidance: /Fictional mock output/i.test(text) && /do not present it as real/i.test(text),
        forbiddenWatermarkClaim: forbiddenResponseClaim.test(text),
        hostedUrl: summarizeUrl(urls.hosted),
        editUrl: summarizeUrl(urls.edit),
      };
      if (format === 'image' && image) {
        record.inline = await inspectPng(Buffer.from(image.data, 'base64'), `${platform}-inline-launch-clean.png`);
      }
      if (format === 'image' && urls.hosted) {
        record.hosted = await probeHosted(urls.hosted, `${platform}-hosted-launch-clean.png`);
      }
      cases.push(record);
      if (format === 'image') {
        productionImageCases += 1;
        if (productionImageCases === 4) await delay(65000);
      }
    }
  }

  for (const platform of ['whatsapp', 'whatsapp-group']) {
    for (const format of ['image', 'link']) {
      const called = await callToolWithPreviewRetry({
          platform,
          format,
          contact: 'Jamie',
          messages: [
            {
              text: 'Synthetic attachment for launch review',
              sender: 'them',
              time: '09:41',
              image: { data: attachment.toString('base64'), mimeType: 'image/png', alt: 'Synthetic launch board' },
            },
          ],
        });
      const result = called.result;
      const text = result.content.find((item) => item.type === 'text')?.text ?? '';
      const image = result.content.find((item) => item.type === 'image');
      const urls = extractUrls(text);
      const record = {
        id: `${platform}-${format}-attachment`,
        platform,
        format,
        attachment: true,
        protocolAttempts: called.attempts,
        isError: Boolean(result.isError),
        contentTypes: result.content.map((item) => item.type),
        fictionalGuidance: /Fictional mock output/i.test(text) && /do not present it as real/i.test(text),
        attachmentPrivacyGuidance: /Attachment bytes are embedded/i.test(text) && /URL as sensitive/i.test(text),
        forbiddenWatermarkClaim: forbiddenResponseClaim.test(text),
        hostedUrl: summarizeUrl(urls.hosted),
        editUrl: summarizeUrl(urls.edit),
      };
      if (format === 'image' && image) {
        record.inline = await inspectPng(Buffer.from(image.data, 'base64'), `${platform}-attachment-inline-launch-clean.png`);
      }
      if (format === 'image' && urls.hosted) {
        record.hosted = await probeHosted(urls.hosted, `${platform}-attachment-hosted-launch-clean.png`);
      }
      cases.push(record);
    }
  }

  const imageInspections = cases.flatMap((entry) => [entry.inline, entry.hosted?.image]).filter(Boolean);
  const ocrAvailableForEveryImage = imageInspections.every((entry) => entry.ocr.available);
  const imageFormatCases = cases.filter((entry) => entry.format === 'image').length;
  const hostedImageProbeCases = cases.filter((entry) => entry.format === 'image' && entry.hosted).length;
  const manifest = {
    capturedAtUtc: new Date().toISOString(),
    command: 'node docs/pr-evidence/watermark-free/capture-production.mjs',
    baseSha,
    workingTreeDirty,
    productionSite: 'https://mockscreenshots.com',
    transport: 'Client + StdioClientTransport',
    packageVersion: packageJson.version,
    serverVersion: client.getServerVersion(),
    toolNames: tools.tools.map((tool) => tool.name),
    generateToolDescription: generate.description,
    cases,
    summary: {
      totalCases: cases.length,
      successfulCases: cases.filter((entry) => !entry.isError).length,
      allPlatforms: platforms.every((platform) => cases.some((entry) => entry.platform === platform)),
      bothFormats: ['image', 'link'].every((format) => cases.some((entry) => entry.format === format)),
      whatsappAttachmentCases: cases.filter((entry) => entry.attachment).length,
      allResponsesRetainFictionalGuidance: cases.every((entry) => entry.fictionalGuidance),
      noResponseClaimsVisibleWatermark: cases.every((entry) => !entry.forbiddenWatermarkClaim),
      inlineImageSuccesses: cases.filter((entry) => entry.format === 'image' && entry.contentTypes.includes('image')).length,
      safeTextLinkFallbacks: cases.filter((entry) => entry.format === 'image' && !entry.contentTypes.includes('image') && entry.hostedUrl && entry.editUrl).length,
      allImageFormatsReturnedInlinePngOrSafeFallback: cases.filter((entry) => entry.format === 'image').every((entry) => (entry.contentTypes.includes('image') && entry.inline?.pngSignature) || (!entry.contentTypes.includes('image') && entry.hostedUrl && entry.editUrl)),
      imageFormatCases,
      hostedImageProbeCases: hostedImageProbeCases,
      everyImageFormatCaseHasHostedProbe: hostedImageProbeCases === imageFormatCases,
      allHostedImageProbesHttp200Png: cases.filter((entry) => entry.hosted).every((entry) => entry.hosted.status === 200 && entry.hosted.contentType?.startsWith('image/png') && entry.hosted.image?.pngSignature),
      ocrAvailableForEveryImage,
      noForbiddenWatermarkTextDetectedByOcr: ocrAvailableForEveryImage
        ? imageInspections.every((entry) => entry.ocr.forbiddenPixelTextFound === false)
        : null,
      packageHandshakeVersionConsistent: client.getServerVersion().version === packageJson.version,
    },
    coverageNotes: {
      endpointErrorsTimeoutsAndUnsafeResponses: 'Covered by real Client + StdioClientTransport tests with controlled HTTP endpoint fixtures in test/server.test.mjs.',
      visualPixelInspection: 'OCR is an automated text-region check only. Representative inline and hosted PNGs require independent human visual inspection before merge.',
      publication: 'No tag, npm publish, or MCP Registry publication was performed.',
    },
  };
  await writeFile(`${evidenceDir}/production-protocol-result.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(manifest.summary, null, 2));
  const criticalGates = [
    manifest.summary.allPlatforms,
    manifest.summary.bothFormats,
    manifest.summary.allResponsesRetainFictionalGuidance,
    manifest.summary.noResponseClaimsVisibleWatermark,
    manifest.summary.allImageFormatsReturnedInlinePngOrSafeFallback,
    manifest.summary.everyImageFormatCaseHasHostedProbe,
    manifest.summary.allHostedImageProbesHttp200Png,
    manifest.summary.packageHandshakeVersionConsistent,
  ];
  if (criticalGates.some((value) => value === false)) process.exitCode = 1;
} finally {
  await client.close();
}
