# MCP WhatsApp image-attachment PR evidence

Captured 2026-07-21 UTC with synthetic data only. This directory proves public MCP parity with the merged and deployed site contract from devyeshtandon/mock-screenshots PR #3 (merge commit `86b6882b6bf47ad7d3bdf47132f7707a9fa3ec3f`).

## Files

- `request-fixture.json`: frozen Jamie/online/iphone-16-pro/light input, exact benchmark messages/times, competitor URLs, and merged endpoint/schema contract.
- `competitor-fakedetail-before.png`: newly captured public competitor-before flow using exactly the frozen two-message input; SHA-256 `e793550e10c6e68626ca6a0cff9166071bc3810e5afe5f2ca2d4b46d58f6aa3f`.
- `synthetic-launch-board.png`: deterministic benign 320x180 PNG from the site PR evidence; SHA-256 `c6fb09303f1d8c66bba3cdeaff06fbba8ecabdbaf7a81d0eabb5356e799ffb05`.
- `capture-production.mjs`: reproducible actual `Client` + `StdioClientTransport` production exercise; two attempts for each platform and explicit success/fallback classification.
- `stdio-production-result.json`: exact command, handshake, per-attempt timings/outcomes, hosted/edit result text, preview hashes, current summary, and the two earlier release-review HTTP 500 fallback observations.
- `previews/whatsapp-watermarked.png`: current production 1:1 inline MCP preview.
- `previews/whatsapp-group-watermarked.png`: current production group inline MCP preview.
- `frozen-rubric-results.json`: frozen rubric v1.1 result, weighted 94.75/80 with all hard thresholds passed.
- `SHA256SUMS`: checksums for every committed evidence input, script, record, rubric, and image.

## Competitor input parity

The old competitor image was not valid identical-input evidence: it retained FakeDetail's default `Hey, what's up?` 8:42 AM message and thumbs-up reaction. It was replaced, not relabeled. The replacement was captured after deleting that default message and setting reaction to none. It contains exactly:

1. incoming `The launch moved to Friday. 🚀` at 09:41 with `synthetic-launch-board.png`;
2. outgoing `Got it — I'll update the brief.` at 09:42 with the same attachment and read ticks.

The contact is synthetic `Jamie`; there is no third/default message and no reaction. The public competitor renders times as `9:41` and `9:42` (without a leading zero), while the form values and frozen fixture are `09:41` and `09:42`. That display formatting difference is disclosed and is not an input difference.

Capture verification output:

```text
The launch moved to Friday. 🚀
9:41
Got it — I'll update the brief.
9:42
messageCount=2
```

## Production protocol outcomes

Exact current command:

```bash
node docs/pr-evidence/whatsapp-image-attachments/capture-production.mjs
```

Current production rerun at `2026-07-21T02:52:05.610Z` from reviewed SHA `02d6b8b5ef6d895486701aa7729af8a7bf7a13b8`:

| Platform | Attempt | Time | Outcome | Content |
|---|---:|---:|---|---|
| whatsapp | 1 | 297 ms | inline image+text success | `image,text` |
| whatsapp | 2 | 38 ms | inline image+text success | `image,text` |
| whatsapp-group | 1 | 33 ms | inline image+text success | `image,text` |
| whatsapp-group | 2 | 33 ms | inline image+text success | `image,text` |

All four current attempts also returned hosted full-resolution and edit URLs plus the fictional/watermarked ethics warning.

This does **not** erase the release-review result: two earlier real `whatsapp-group` production stdio reruns at the same reviewed SHA received HTTP 500 from the render endpoint. The MCP behaved gracefully by returning `text` only with hosted/edit URLs and the ethics warning. Those attempts were **text-link fallbacks, not inline image+text successes**, and are preserved in `stdio-production-result.json`. Endpoint stability had recovered for the four-attempt current rerun above.

## Security and compatibility

- Input is base64 bytes, never a caller-selected URL; no user-controlled server-side fetch or SSRF path is added.
- PNG/JPEG/WebP only, strict base64 and magic-byte matching, 2 MB decoded cap, 160-character alt cap, SVG/script rejection.
- The existing site 8,000-character encoded-state limit is enforced before a link or render request is produced.
- Preview responses require HTTP success, `image/png`, a PNG signature, and at most 10 MB; failures/timeouts return safe hosted/edit links with the ethics warning.
- The optional public `messages[].image` maps to merged `m[].im`; text-only behavior and content types remain unchanged.
- Every successful format, preview fallback, and validation error includes the mandatory watermarked/fictional ethics warning. There is no watermark bypass.
- Fixtures contain no credentials, tokens, private user data, real identities, or real uploads.

Verification commands:

```bash
npm ci
npm test
node docs/pr-evidence/whatsapp-image-attachments/capture-production.mjs
sha256sum -c docs/pr-evidence/whatsapp-image-attachments/SHA256SUMS
git diff --check
npm pack --dry-run --json
```
