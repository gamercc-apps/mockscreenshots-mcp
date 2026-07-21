# MCP WhatsApp image-attachment PR evidence

Captured 2026-07-21 UTC with synthetic data only. This directory proves public MCP parity with the merged and deployed site contract from devyeshtandon/mock-screenshots PR #3 (merge commit `86b6882b6bf47ad7d3bdf47132f7707a9fa3ec3f`).

Files:

- `request-fixture.json`: frozen Jamie/online/iphone-16-pro/light input, exact benchmark messages/times, competitor URLs, and merged endpoint/schema contract.
- `competitor-fakedetail-before.png`: dated public competitor-before flow copied byte-for-byte from merged site PR evidence; SHA-256 `c090e923d5310c72bbc6a3a47e8b6388028ad96a5d5852ae00ea93af9fcf1eaa`.
- `synthetic-launch-board.png`: deterministic benign 320x180 PNG from the site PR evidence; SHA-256 `c6fb09303f1d8c66bba3cdeaff06fbba8ecabdbaf7a81d0eabb5356e799ffb05`.
- `capture-production.mjs`: reproducible actual `Client` + `StdioClientTransport` production exercise.
- `stdio-production-result.json`: handshake, timings, hosted/edit result text, preview hashes, and observed guarantees.
- `previews/whatsapp-watermarked.png`: actual production 1:1 inline MCP preview.
- `previews/whatsapp-group-watermarked.png`: actual production group inline MCP preview.
- `frozen-rubric-results.json`: frozen rubric v1.0 result, weighted 95.75/80 with all hard thresholds passed.

The production previews visibly contain the same two benign synthetic image attachments, both exact benchmark messages/times, and repeated `mockscreenshots.com` watermarking without clipping. The first group cold-render attempt returned HTTP 500; the MCP correctly fell back to watermarked hosted/edit links. An immediate rerun succeeded with inline PNG+text in 2915 ms. This transient is retained in the rubric risk note.

Security and compatibility:

- Input is base64 bytes, never a caller-selected URL; no user-controlled server-side fetch or SSRF path is added.
- PNG/JPEG/WebP only, strict base64 and magic-byte matching, 2 MB decoded cap, 160-character alt cap, SVG/script rejection.
- The existing site 8,000-character encoded-state limit is enforced before a link or render request is produced.
- Preview responses require HTTP success, `image/png`, a PNG signature, and at most 10 MB; failures/timeouts return safe hosted/edit links with the ethics warning.
- The optional public `messages[].image` maps to merged `m[].im`; text-only behavior and content types remain unchanged.
- Every successful format, preview fallback, and validation error includes the mandatory watermarked/fictional ethics warning. There is no watermark bypass.
- Fixtures contain no credentials, tokens, private user data, real identities, or real uploads.
