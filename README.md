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
    { "text": "you home?", "sender": "them", "time": "19:01" },
    { "text": "5 mins!", "sender": "me", "time": "19:02", "ticks": "read" }
  ]
}
```

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

The server never renders images. It encodes the conversation into a compact,
URL-safe `?s=` parameter that the generator reads on load (`src/lib/share.ts`). This
keeps the server tiny and dependency-light, and keeps the human in the loop to preview,
tweak and export.
