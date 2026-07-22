# Watermark-free MCP production evidence

Captured 2026-07-22 UTC from the 0.1.7 implementation candidate based on
`5a0f7b64ba7f703459d2c5141ec7639042df8b02`. The capture correctly records that the
working tree was dirty; the PR head is the review identity after commit. All fixtures are
fictional and synthetic.

## Contract result

The real `Client` + `StdioClientTransport` capture exercised 18 production cases:

- all seven public render platforms: iMessage, WhatsApp 1:1, WhatsApp group, Instagram,
  Telegram, Messenger, and Snapchat;
- `format: "image"` and `format: "link"` for text-only messages;
- both formats with a synthetic image attachment for WhatsApp 1:1 and group;
- hosted full-resolution and deep edit URLs;
- MCP/package handshake at 0.1.7.

All 18 MCP calls returned a protocol success. Every response retained “Fictional mock
output — do not present it as real” guidance; none claimed a visible watermark. The four
attachment responses also retained the URL/privacy warning.

Production rendering remained operationally variable and is not overstated: 5/9 image
requests returned inline PNG+text; the other 4 safely returned hosted/edit links. The
hardened gate confirmed that all 9/9 image-format cases had a direct hosted probe; 8/9
eventually returned HTTP 200 `image/png` with valid PNG signatures. WhatsApp 1:1 attachment
full resolution returned four HTTP 500 responses during this capture, while its MCP response
retained a safe text-link fallback. This preserves and freshly demonstrates the documented
endpoint error path rather than treating fallback as image success. Cross-colo and stress
reliability remain unproven.

See `production-protocol-result.json` for every attempt, status, duration, content type,
signature, byte count, and SHA-256. The harness waits across the deployed 30/60-second rate
limit boundary and deliberately records 429/500 responses rather than hiding them.

## Pixel inspection

Automated OCR was unavailable on the capture host, so no OCR claim is made. Independent
visual inspection was performed on one valid returned PNG for every platform, including the
WhatsApp group attachment output:

- `outputs/imessage-inline-launch-clean.png`
- `outputs/whatsapp-hosted-launch-clean.png`
- `outputs/whatsapp-group-attachment-hosted-launch-clean.png`
- `outputs/instagram-hosted-launch-clean.png`
- `outputs/telegram-hosted-launch-clean.png`
- `outputs/messenger-inline-launch-clean.png`
- `outputs/snapchat-hosted-launch-clean.png`

No inspected output contained repeated diagonal branding, `mockscreenshots.com`, `FAKE`, or
another visible watermark. The faint star pattern in WhatsApp renders is the normal chat
wallpaper, not product branding. The group output visibly preserved the synthetic four-color
attachment.

Inline PR sample: `outputs/whatsapp-group-attachment-hosted-launch-clean.png`.

## Local protocol and safety coverage

`test/server.test.mjs` uses the actual MCP client and stdio transport with controlled HTTP
render fixtures. It covers all platforms and both formats, WhatsApp image/text and image-only
messages, deterministic hosted/edit URLs, text-only compatibility, endpoint 503 and timeout
fallbacks, invalid content type, invalid PNG, deceptive/oversized/chunked responses, bounded
message/metadata/aggregate state, no remote URL/SSRF path, PNG/JPEG/WebP signatures, SVG and
script rejection, and package/server/handshake consistency.

No endpoint, timeout, image, state, privacy, rate-limit, error, or resource-bound control was
weakened. No tag, npm publish, MCP Registry update, merge, or deployment was performed.

## Reproduce

```bash
npm ci
npm test
node docs/pr-evidence/watermark-free/capture-production.mjs
npm pack --dry-run --json
git diff --check
```

The production command can legitimately exit nonzero when a hosted endpoint cannot produce
all requested PNGs; inspect the manifest rather than relabeling a safe fallback as success.
