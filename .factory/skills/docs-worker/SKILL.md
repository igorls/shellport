---
name: docs-worker
description: Creates VitePress documentation pages, configuration, and deployment infrastructure for Shellport docs site.
---

# Docs Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use this worker for creating:
- VitePress configuration and theme customization
- Documentation pages (guides, API references, internals)
- Landing pages and navigation structure
- GitHub Actions deployment workflows

## Work Procedure

### 1. Understand the Feature
Read the feature description carefully. Identify:
- Which files need to be created
- What content should be extracted from README.md or source code
- Which pages or sections are involved

### 2. Create Directory Structure
If creating new directories:
```bash
mkdir -p docs/getting-started
mkdir -p docs/guides
mkdir -p docs/api
mkdir -p docs/internals
mkdir -p docs/public
mkdir -p docs/.vitepress/theme
```

### 3. Write Files

For documentation pages:
- Extract accurate information from README.md, CHANGELOG.md, and source files
- Use proper Markdown formatting with headings, code blocks, tables
- Include practical examples and usage commands
- Add frontmatter for VitePress (title, description) when needed

For VitePress config:
- Use TypeScript (`config.ts`)
- Configure sidebar with collapsible sections
- Set base path to `/shellport/` for GitHub Pages
- Enable search with `localSearch` option

For theme customization:
- Extend the default theme
- Override colors in CSS custom properties
- Import logo from `public/logo.png`

For GitHub Actions:
- Use `actions/checkout@v4`
- Use `actions/configure-pages@v4`
- Use `actions/upload-pages-artifact@v3`
- Use `actions/deploy-pages@v4`
- Build with Bun

### 4. Verify Build
After creating files:
```bash
bun run docs:build
```
Exit code must be 0. Check for build errors.

### 5. Test Locally (if applicable)
For navigation and UI features:
```bash
bun run docs:dev
```
Open http://localhost:5173 in browser. Verify:
- Page renders
- Navigation works
- No console errors
- Mobile responsive

### 6. Commit Changes
Stage all files:
```bash
git add docs/ .github/workflows/ package.json
```

Commit with meaningful message:
```bash
git commit -m "docs: add VitePress infrastructure and landing page"
```

---

## Example Handoff

```json
{
  "salientSummary": "Created VitePress configuration, custom theme with Shellport branding, and landing page with hero section and feature highlights grid. Build succeeds locally.",
  "whatWasImplemented": "Created docs/.vitepress/config.ts with sidebar navigation for all sections (Getting Started, Guides, API Reference, Internals, Comparison). Created docs/.vitepress/theme/index.ts extending default VitePress theme with dark theme and purple accent colors (#a78bfa). Created docs/public/logo.png (copied from project root). Created docs/index.md landing page with hero section, feature grid, and call-to-action buttons. Added docs:dev, docs:build, docs:preview scripts to package.json.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "bun run docs:build",
        "exitCode": 0,
        "observation": "Build completed successfully, output in docs/.vitepress/dist/"
      },
      {
        "command": "bun run docs:dev",
        "exitCode": 0,
        "observation": "Dev server started on http://localhost:5173"
      }
    ],
    "interactiveChecks": [
      {
        "action": "Opened http://localhost:5173 and verified landing page renders",
        "observed": "Hero section displayed with logo, feature grid shows 6 cards, Get Started button navigates to /getting-started/installation"
      },
      {
        "action": "Verified sidebar navigation",
        "observed": "All sections visible (Getting Started, Guides, API Reference, Internals), clicking links navigates correctly, active page highlighted"
      },
      {
        "action": "Verified mobile responsive design",
        "observed": "Sidebar hidden on mobile (< 768px), hamburger menu toggles sidebar, content readable on mobile viewport"
      }
    ]
  },
  "tests": {
    "added": []
  },
  "discoveredIssues": []
}
```

---

## When to Return to Orchestrator

- VitePress fails to install (dependency issues)
- Build errors that can't be resolved (missing dependencies, config errors)
- Logo file format issues that can't be fixed (corrupted, unsupported format)
- Content extraction reveals incomplete source documentation — ask for clarification
- GitHub Pages deployment fails in a way that requires repository settings changes
- Need clarification on content accuracy for technical details

---

## Content Extraction Guidelines

When extracting content from source files:

1. **README.md**: Primary source for user-facing documentation
   - Feature descriptions
   - Installation instructions
   - Usage examples
   - Comparison tables
   - Security model overview

2. **CHANGELOG.md**: For release history and version information
   - Major version changes
   - New features
   - Breaking changes

3. **Source Code (src/)**: For API reference accuracy
   - CLI options from `src/index.ts`
   - NanoTermV2 options from `src/frontend/nanoterm/`
   - Types from `src/types.ts`

4. **Architecture**: From README.md Architecture section
   - Directory structure
   - Data flow
   - Component explanations

Always verify extracted content is accurate and up-to-date.
