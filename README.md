# Mock Screenshots MCP server

An [MCP](https://modelcontextprotocol.io) server that lets an AI agent compose a fake
chat and get a deep link to the matching [Mock Screenshots](https://mockscreenshots.com)
generator — pre-filled and ready to preview and download.

Output is **watermarked and clearly fictional**, intended for parody, education, design
mockups and fiction. It is **not** for deception — see
[the ethics policy](https://mockscreenshots.com/ethics).

## Tools

| Tool | What it does |
|------|--------------|
| `generate_fake_chat` | Compose a conversation (platform, messages, contact, status, device, dark) → returns a rendered, watermarked PNG (inline preview + hosted URL for download/share) plus a deep link to the generator. Supports `format: "image"` (default, returns preview+URL) or `"link"` (text-only URLs). |
| `list_platforms` | Lists supported chat apps and their generator URLs. |
| `list_devices` | Lists the iPhone/Android device frames. |

### `generate_fake_chat` input

```jsonc
{
  "platform": "whatsapp",            // imessage | whatsapp | whatsapp-group | instagram | telegram | messenger | snapchat
  "contact": "Mom",                  // header name / username / group name
  "status": "typing…",               // header status line (optional)
  "device": "galaxy-s24",            // see list_devices (default iphone-16-pro)
  "dark": true,                      // dark mode (optional)
  "format": "image",                 // "image" (default) | "link" — see Screenshots section
  "messages": [
    {
      "text": "you home?",
      "sender": "them",
      "time": "19:01",
      "image": {
        "data": "<base64 PNG, JPEG, or WebP bytes>",
        "mimeType": "image/png",
        "alt": "A synthetic design mockup"
      }
    },
    { "text": "5 mins!", "sender": "me", "time": "19:02", "ticks": "read" }
  ]
}
```

`messages[].image` is optional and supported only for `whatsapp` and
`whatsapp-group`, so existing text-only requests remain unchanged. Image-only messages
are also supported. Attachments must be self-contained PNG, JPEG, or WebP bytes with a
matching file signature; SVG, remote URLs, malformed base64, and files over 2 MB are
rejected. Alternative text is trimmed to 160 characters and defaults to `Attached image`.
The merged site endpoint limits the complete base64url state to 8,000 characters, so a
smaller attachment may still be required after conversation metadata is included.

### Screenshots

Returns a **rendered, watermarked screenshot** server-side via the site's `GET /api/render` endpoint (Cloudflare Browser Rendering). Default output (`format: "image"`) includes:
- **Inline preview image** (scaled, watermarked — displays immediately)
- **Hosted full-res PNG URL** (download / share in DMs, always watermarked and clearly fictional)
- **Deep edit link** to the generator, pre-filled with your conversation

Alternately, use `format: "link"` for text-only output (just the URLs, no image preview).

**Always watermarked:** Screenshots include a prominent "FAKE" watermark and cannot be disabled. This ensures they remain clearly fictional and non-deceptive for parody, education, design mockups and fiction — see [the ethics policy](https://mockscreenshots.com/ethics).

Also returns a URL like
`https://mockscreenshots.com/fake-whatsapp-chat-generator?s=<state>` that opens the
generator with the conversation loaded (for preview/tweaking before final export).

## Run

```bash
npm install
npm start           # stdio server
```

### Use with Claude Desktop / Claude Code

```jsonc
// claude_desktop_config.json  (or: claude mcp add)
{
  "mcpServers": {
    "mockscreenshots": {
      "command": "node",
      "args": ["/absolute/path/to/mcp/server.mjs"]
    }
  }
}
```

Once published to npm you can instead use `npx -y mockscreenshots-mcp`.

## Publishing / distribution

1. `npm publish` the `mockscreenshots-mcp` package.
2. Register on `registry.modelcontextprotocol.io` using `server.json`.
3. Submit to mcp.so, Smithery, PulseMCP, Glama, and open a PR to `awesome-mcp-servers`.

Each listing is a genuine dofollow dev-domain link + agent discovery — the uncontested
distribution channel 

## How it works

The MCP server itself stays tiny and stateless: it builds URLs and encodes the
conversation into a compact, URL-safe `?s=` parameter (also read by the generator on
load, `src/lib/share.ts`), then fetches a preview from the site's `/api/render`
endpoint, which does the actual (always-watermarked) server-side rendering via
Cloudflare Browser Rendering. This keeps the server dependency-light and keeps the
human in the loop to preview, tweak and export.

The server never fetches a caller-supplied attachment URL. Preview responses are accepted
only when they are bounded PNG data from the fixed Mock Screenshots endpoint; endpoint
errors and timeouts safely fall back to the hosted image/edit links while retaining the
watermark and ethics warning.
