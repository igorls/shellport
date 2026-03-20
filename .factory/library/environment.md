# Environment

Environment variables, external dependencies, and setup notes.

**What belongs here:** Required env vars, external API keys/services, dependency quirks, platform-specific notes.

**What does NOT belong here:** Service ports/commands (use `.factory/services.yaml`).

---

## Dependencies

- **Bun**: Primary runtime and package manager
- **VitePress**: Documentation site generator (installed as dev dependency)
- No external services or APIs required

## Environment Variables

None required for documentation site development.

## Platform Notes

- VitePress dev server runs on port 5173 by default
- Build output goes to `docs/.vitepress/dist/`
- GitHub Pages deployment serves from `gh-pages` branch

## Git Configuration

Repository is on GitHub at `https://github.com/igorls/shellport`.
Default branch is `main`.
GitHub Pages URL will be `https://igorls.github.io/shellport/`.
