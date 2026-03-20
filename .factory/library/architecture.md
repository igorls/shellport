# Architecture

Architectural decisions, patterns discovered.

**What belongs here:** Key architectural decisions, design patterns, important constraints.

---

## Project Structure

```
shellport/
├── src/                    # Core application source
│   ├── index.ts           # CLI entry point
│   ├── server.ts          # HTTP + WebSocket server
│   ├── client.ts          # CLI WebSocket client
│   ├── crypto.ts          # E2E encryption (AES-256-GCM)
│   ├── totp.ts            # TOTP 2FA implementation
│   ├── qr.ts              # QR code generator
│   ├── types.ts           # TypeScript types
│   └── frontend/          # Web terminal frontend
│       ├── nanoterm/      # Canvas terminal emulator
│       └── app.js         # Session manager UI
├── docs/                   # Documentation site (VitePress)
│   ├── .vitepress/        # VitePress configuration
│   ├── public/            # Static assets
│   └── *.md               # Documentation pages
├── test/                   # Test files
├── logo.png               # Project logo (JPEG format)
├── README.md              # Main documentation
├── CHANGELOG.md           # Version history
└── package.json           # NPM package definition
```

## Key Technologies

- **Bun**: Runtime, bundler, package manager
- **Canvas2D**: Terminal rendering (WebGL planned)
- **VitePress**: Static site generator for docs
- **GitHub Pages**: Hosting platform

## Documentation Site Architecture

The docs site is a static site built by VitePress:

1. **Content**: Markdown files in `docs/` directory
2. **Config**: `docs/.vitepress/config.ts` (nav, sidebar, theme)
3. **Theme**: Custom theme extending VitePress default
4. **Build**: VitePress compiles MD -> HTML/CSS/JS
5. **Deploy**: GitHub Actions builds and deploys to `gh-pages` branch

## Content Sources

When writing docs, extract from:
- `README.md` - Feature descriptions, usage, comparison
- `CHANGELOG.md` - Version history
- `src/index.ts` - CLI options and commands
- `src/frontend/nanoterm/` - NanoTermV2 API

## Branding

- Logo: `logo.png` (640x640, actually JPEG format)
- Accent color: `#a78bfa` (purple-400)
- Theme: Dark mode matching terminal aesthetic
