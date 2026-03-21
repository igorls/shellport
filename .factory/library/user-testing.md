# User Testing Guidance - Shellport Docs Site

## Validation Concurrency

Based on dry run analysis:
- **Max concurrent validators: 3** (per mission.md guidance for docs site)
- System has ~47 GiB available memory
- Each Chromium instance with agent-browser uses ~2-4 GiB

## Testing Tools

### Web UI Testing: agent-browser

Use the `agent-browser` skill for browser automation testing. Key capabilities:
- Navigate to pages and take snapshots
- Fill forms and click elements
- Verify network requests
- Screenshot evidence capture

**Session naming convention:** Always pass `--session` flag with session ID format:
- Single browser: `--session "70e74ecca11f"`
- Use the first 12 characters of the worker session ID for brevity

## Environment Setup

### Prerequisites

1. **Services must be running:**
   - VitePress dev server on port 5173 (base path: /shellport/)

2. **Health checks:**
   ```bash
   curl -sf http://localhost:5173/shellport/
   ```

### Starting the Dev Server

```bash
cd /home/igorls/dev/GitHub/shellport
bunx vitepress dev docs --port 5173
```

The server runs on http://localhost:5173/shellport/

## Flow Validator Guidance: VitePress Docs Site (Port 5173)

### Navigation Structure

```
/shellport/                          → Landing page
/shellport/getting-started/installation → Installation page
/shellport/getting-started/quick-start  → Quick Start page
/shellport/guides/basic-usage           → Basic Usage page
/shellport/guides/security              → Security page
/shellport/guides/totp                  → TOTP page
/shellport/guides/tailscale              → Tailscale page
/shellport/api/cli                      → CLI Reference
/shellport/api/nanoterm                 → NanoTermV2 Library
/shellport/internals/architecture       → Architecture page
/shellport/internals/security-model     → Security Model page
/shellport/comparison                   → Comparison page
```

### Test Isolation Rules

1. **Shared state:** All validators share the same VitePress dev server
2. **Data modifications:** None (static documentation site)
3. **Concurrent testing:** Safe to run multiple browser instances concurrently
4. **No conflicts:** Static site with no mutable state

### Isolation Boundaries

For concurrent testing:
- Each validator operates independently on the same static site
- No isolation resources needed beyond the shared URL
- Screenshots and evidence stored separately per validator

### URLs

- Base URL: `http://localhost:5173/shellport/`
- Landing: `http://localhost:5173/shellport/`
- Installation: `http://localhost:5173/shellport/getting-started/installation`
- Quick Start: `http://localhost:5173/shellport/getting-started/quick-start`
- Basic Usage: `http://localhost:5173/shellport/guides/basic-usage`
- Security: `http://localhost:5173/shellport/guides/security`
- TOTP: `http://localhost:5173/shellport/guides/totp`
- Tailscale: `http://localhost:5173/shellport/guides/tailscale`
- CLI Reference: `http://localhost:5173/shellport/api/cli`
- NanoTermV2: `http://localhost:5173/shellport/api/nanoterm`
- Architecture: `http://localhost:5173/shellport/internals/architecture`
- Security Model: `http://localhost:5173/shellport/internals/security-model`
- Comparison: `http://localhost:5173/shellport/comparison`

### Assertion Groups

| Group | Assertions | Focus |
|-------|------------|-------|
| landing | VAL-LANDING-001, VAL-LANDING-002, VAL-LANDING-003 | Hero section, features grid, navigation links |
| navigation | VAL-NAV-001, VAL-NAV-002, VAL-NAV-003, VAL-NAV-004 | Sidebar, header, mobile toggle |
| search | VAL-SEARCH-001, VAL-SEARCH-002 | Search modal, results |
| getting-started | VAL-GETTING-001, VAL-GETTING-002 | Installation and Quick Start pages |
| guides | VAL-GUIDES-001, VAL-GUIDES-002, VAL-GUIDES-003, VAL-GUIDES-004 | All guide pages content |
| api | VAL-API-001, VAL-API-002 | CLI and NanoTermV2 reference pages |
| internals | VAL-INTERNALS-001, VAL-INTERNALS-002 | Architecture and Security Model pages |
| comparison | VAL-COMPARISON-001 | Comparison table |
| theme | VAL-THEME-001, VAL-THEME-002, VAL-THEME-003 | Logo, colors, edit links |
| deployment | VAL-DEPLOY-001, VAL-DEPLOY-002, VAL-DEPLOY-003 | GitHub Actions, build, deployment |
| cross-area | VAL-CROSS-001, VAL-CROSS-002, VAL-CROSS-003 | Multi-page flows |

## Evidence Storage

Save evidence to: `{missionDir}/evidence/docs-site/{group-id}/`
- Screenshots: `.png` files
- Network logs: `.json` files
- Console logs: `.log` files
