# MCP WhatsApp image-attachment PR evidence

> Archived pre-launch policy evidence for merged PR #1. The watermark observations and
> source/version status below are historical and are superseded for current behavior by
> `../watermark-free/`. Historical PNGs, hashes, cold-render failures, and frozen scoring are
> intentionally retained rather than rewritten.

Captured 2026-07-21 UTC with synthetic data only. This directory records the frozen benchmark, historical release-review failure, the later owner waiver and site deployment, and fresh post-deployment production results. The MCP source under test is `1ed955991b717b4bc30bf19364c01454708b2e5f`; the final evidence-only commit is linked from PR #1.

## Current status (post-deployment)

- Site PR [devyeshtandon/mock-screenshots#4](https://github.com/devyeshtandon/mock-screenshots/pull/4) was squash-merged and deployed. The owner explicitly waived the original hard Cloudflare/cold-render reliability threshold for that deployment. The historical threshold did **not** pass and is not relabeled as passed.
- Fresh real `Client` + `StdioClientTransport` evidence below returned 8/8 inline image+text successes across WhatsApp 1:1 and group, with hosted/edit URLs and no protocol errors. The eight directly probed full-resolution URLs were all HTTP 200 `image/png` with valid PNG signatures.
- Independent release review at 2026-07-21T08:05–08:07Z separately observed 24/24 inline image+text successes across six four-attempt runs and 4/4 HTTP 200 PNG full-resolution probes (403,323 bytes for 1:1; 411,143 bytes for group).
- Fresh preview inspection found repeated `mockscreenshots.com` watermarking on both currently deployed outputs. This is an observation only. Owner policy permits watermark-free initial output, so a later no-watermark render is not by itself a release failure.
- The prior site dependency is resolved by merge/deployment plus the explicit waiver; it is no longer a current blocking dependency. Human approval is still required before merging or releasing this MCP PR.

## Files

- `request-fixture.json`: frozen Jamie/online/iPhone 16 Pro/light input, exact benchmark messages/times, competitor URLs, and endpoint/schema contract.
- `competitor-fakedetail-before.png`: corrected public competitor-before flow using exactly the frozen two-message input; SHA-256 `e793550e10c6e68626ca6a0cff9166071bc3810e5afe5f2ca2d4b46d58f6aa3f`.
- `synthetic-launch-board.png`: deterministic benign 320×180 PNG from the site evidence; SHA-256 `c6fb09303f1d8c66bba3cdeaff06fbba8ecabdbaf7a81d0eabb5356e799ffb05`.
- `capture-production.mjs`: reproducible real `Client` + `StdioClientTransport` exercise; four attempts per platform, explicit success/fallback classification, and direct full-resolution URL probes.
- `stdio-production-result.json`: handshake/version, per-attempt timings, content types, hosted/edit URL presence, errors, preview metadata, direct hosted PNG probe results, and preserved historical cold-failure observations.
- `previews/whatsapp-watermarked.png` and `previews/whatsapp-group-watermarked.png`: then-current pre-launch production inline previews.
- `frozen-rubric-results.json`: unchanged frozen weights and 83.9/100 score, with historical failed hard thresholds retained and the current owner-waiver/deployment status stated separately.
- `SHA256SUMS`: checksums for every committed evidence input, script, record, rubric, and image.

## Frozen competitor input parity

The previous competitor image was replaced because it retained FakeDetail's default message and reaction. The corrected capture contains exactly:

1. incoming `The launch moved to Friday. 🚀` at 09:41 with `synthetic-launch-board.png`;
2. outgoing `Got it — I'll update the brief.` at 09:42 with the same attachment and read ticks.

The contact is synthetic `Jamie`; there is no third/default message and no reaction. FakeDetail displays the frozen `09:41`/`09:42` form values as `9:41`/`9:42`; that is a disclosed display-only variance.

## Fresh production protocol outcomes

Exact command:

```bash
node docs/pr-evidence/whatsapp-image-attachments/capture-production.mjs
```

Captured `2026-07-21T08:12:17.217Z` from reviewed source SHA `1ed955991b717b4bc30bf19364c01454708b2e5f`:

| Platform | Attempt | MCP time | Outcome/content | Full-resolution probe |
|---|---:|---:|---|---|
| whatsapp | 1 | 822 ms | inline image+text / `image,text` | 406 ms; HTTP 200 PNG; 403,323 bytes |
| whatsapp | 2 | 133 ms | inline image+text / `image,text` | 90 ms; HTTP 200 PNG; 403,323 bytes |
| whatsapp | 3 | 86 ms | inline image+text / `image,text` | 44 ms; HTTP 200 PNG; 403,323 bytes |
| whatsapp | 4 | 83 ms | inline image+text / `image,text` | 46 ms; HTTP 200 PNG; 403,323 bytes |
| whatsapp-group | 1 | 93 ms | inline image+text / `image,text` | 51 ms; HTTP 200 PNG; 411,143 bytes |
| whatsapp-group | 2 | 82 ms | inline image+text / `image,text` | 45 ms; HTTP 200 PNG; 411,143 bytes |
| whatsapp-group | 3 | 95 ms | inline image+text / `image,text` | 49 ms; HTTP 200 PNG; 411,143 bytes |
| whatsapp-group | 4 | 76 ms | inline image+text / `image,text` | 41 ms; HTTP 200 PNG; 411,143 bytes |

All eight attempts returned hosted full-resolution and edit URLs, current ethics/privacy text, `isError: false`, and no fallback/protocol error. Full URLs carry deterministic synthetic attachment state and are redacted in the probe record; their status, type, byte length, PNG signature, and SHA-256 are retained.

### Preserved historical result and waiver

Earlier independent cold-state verification observed HTTP 500 on 100/100 full-resolution probes for each WhatsApp mode, plus two real group stdio text-link fallbacks. Those failures remain in the rubric and `stdio-production-result.json`; graceful fallback is not counted as inline image+text success. The fresh success does not retroactively satisfy or erase that original hard threshold. Site deployment proceeded under the owner's explicit Cloudflare reliability waiver, and the current post-deployment runs above describe present behavior.

## Security, compatibility, and owner policy

- Input is base64 bytes, never a caller-selected URL; no user-controlled server-side fetch or SSRF path is added.
- PNG/JPEG/WebP only, strict base64 and magic-byte matching, 2 MB decoded cap, 160-character alt cap, SVG/script rejection.
- The existing 8,000-character encoded-state limit is enforced before a link or render request is produced.
- Preview responses require HTTP success, `image/png`, a PNG signature, and at most 10 MiB; failures/timeouts return hosted/edit links with the warning text.
- The optional public `messages[].image` maps to merged `m[].im`; text-only behavior and content types remain unchanged.
- The pre-launch MCP path requested and warned about watermarked output. Repeated watermarking was visible in this historical capture, but it is not the current package contract.
- Fixtures contain no credentials, tokens, private user data, real identities, or real uploads.
- Attachment bytes are embedded as data URLs inside the base64url JSON state carried by render/edit URLs. Base64url is not encryption. Use only non-sensitive synthetic or public attachments and treat attachment-bearing URLs as sensitive because transcripts, logs, browser history, analytics/referrers, and cache keys may retain them.
- The MCP preview fetch uses `cache: "no-store"` and `referrerPolicy: "no-referrer"`; this does not control the deployed endpoint or intermediaries. The MCP adds no attachment or URL logging.

## Package and publish implications

`package.json`, `package-lock.json`, `server.json`, and the MCP handshake remain `0.1.6`. npm `latest` for `@gamercc-apps/mockscreenshots-mcp` is already `0.1.6`. Merging PR #1 alone does not publish anything. Any new npm or MCP Registry release requires explicit human approval followed by a coordinated package/lock/server version bump and tag; this PR does not merge, tag, publish, or release.

Verification commands:

```bash
npm ci
npm test                         # 13/13
node docs/pr-evidence/whatsapp-image-attachments/capture-production.mjs
sha256sum -c docs/pr-evidence/whatsapp-image-attachments/SHA256SUMS
git diff --check
npm pack --dry-run --json
```
