# Agent Instructions for Shellport

Shellport is a zero-dependency encrypted terminal bridge with TOTP 2FA and built-in web UI. This file documents essential information for autonomous agents working on this codebase.

## Project Overview

- **Language**: TypeScript with Bun runtime
- **Package Manager**: Bun
- **Build Output**: Single compiled binary (`shellport`)
- **Runtime Dependencies**: Zero (at runtime)

## Setup Commands

```bash
# Install dependencies
bun install

# Run development server
bun run dev

# Build the binary
bun run build

# Run tests
bun test

# Type check
bun run typecheck
```

## Project Structure

```
src/
├── index.ts          # CLI entry point
├── server.ts         # WebSocket server
├── client.ts         # Client implementation
├── crypto.ts         # Encryption (AES-256-GCM, PBKDF2)
├── totp.ts           # TOTP 2FA implementation
├── types.ts          # TypeScript types
├── qr.ts             # QR code generation
├── pty.test.ts       # PTY tests
├── integration.test.ts
├── server.test.ts
├── crypto.test.ts
├── totp.test.ts
├── bounds.test.ts
├── types.test.ts
├── qr.test.ts
├── server_ratelimit.test.ts
└── frontend/
    ├── app.js                    # Main frontend app
    ├── nanoterm/
    │   ├── index.js              # NanoTerm API
    │   ├── webgl-renderer.js     # WebGL renderer
    │   ├── canvas-renderer.js    # Canvas2D renderer
    │   └── constants.js
    └── bundle.ts                 # Frontend bundler
```

## Key Technologies

- **Runtime**: Bun (>=1.0.0)
- **PTY**: Native Bun PTY API
- **WebSocket**: Native Bun WebSocket
- **Encryption**: Web Crypto API (AES-256-GCM, PBKDF2)
- **Frontend**: Custom Canvas2D terminal emulator (~50KB, zero deps)
- **Documentation**: VitePress

## Development Conventions

### TypeScript

- Strict mode enabled in tsconfig.json
- All functions must have explicit return types
- Use `interface` for object shapes, `type` for unions
- No `any` types allowed

### Testing

- Test files: `*.test.ts` pattern
- Run with `bun test`
- Include security audit tests for crypto operations

### Code Style

- Use ESNext modules (`import`/`export`)
- Async/await for asynchronous operations
- Error handling with proper error types

### Security Requirements

- All crypto operations must use Web Crypto API
- TOTP secrets stored in `~/.shellport-totp-secret`
- Secrets passed via URL fragment (#secret) never sent to server
- Rate limiting on connection attempts (5 per IP per minute)

## Build Commands

| Command | Description |
|---------|-------------|
| `bun run dev` | Run development server |
| `bun run build` | Build single binary |
| `bun run build:frontend` | Bundle frontend assets |
| `bun run build:binaries` | Cross-compile all platforms |
| `bun run test` | Run test suite |
| `bun run typecheck` | Run TypeScript type checker |
| `bun run docs:build` | Build VitePress documentation |

## Security Considerations

- No forward secrecy - if secret is compromised, traffic can be decrypted
- TOTP secret stored in `~/.shellport-totp-secret` - protect this file
- Connection approval required by default
- Strict origin validation on WebSocket connections

## Common Tasks

### Adding a new CLI flag

1. Update `src/index.ts` with argument parsing
2. Update TypeScript types if needed
3. Add tests for the new flag
4. Update README.md if user-facing

### Modifying the frontend

1. Edit files in `src/frontend/`
2. Run `bun run build:frontend` to bundle
3. Test in browser via `bun run dev`

### Adding tests

1. Create `*.test.ts` file in `src/`
2. Use Bun's built-in test runner
3. Run `bun test` to verify

## Environment Variables

Shellport does not use environment variables for configuration. All settings are passed via CLI flags:

- `--dev`: Development mode (relaxed origin checks)
- `--no-totp`: Disable TOTP authentication
- `--no-secret`: Disable URL secret
- `--totp-reset`: Reset TOTP pairing

## Notes for Agents

- This is a Bun-only project - do not use npm or yarn
- The binary is self-contained at runtime (no node_modules)
- NanoTermV2 is a standalone library that can be used independently
- Tailscale integration requires Tailscale CLI on the system

## Incident Response

### Security Incidents

If a security vulnerability is discovered:

1. **Do not** commit secrets or credentials to the repository
2. **Report** the issue via GitHub Security Advisories
3. **Rotate** any exposed secrets immediately
4. **Document** the vulnerability and remediation steps

### Common Issues

#### Binary fails to start
- Verify Bun runtime version >= 1.0.0
- Check port 7681 is not already in use
- Ensure Tailscale CLI is installed if using `--tailscale` flag

#### TOTP authentication failing
- Verify system clock is synchronized
- Use `--totp-reset` to regenerate pairing secret
- Check `~/.shellport-totp-secret` file permissions

#### WebSocket connection refused
- Verify server is running (`bun run dev`)
- Check firewall settings for port 7681
- Use `--dev` flag for localhost development

### Recovery Procedures

1. **Binary crashes**: Restart with `bun run dev` or rebuild with `bun run build`
2. **TOTP locked out**: Use `--totp-reset` flag to re-pair authenticator
3. **Port conflicts**: Use `--port <n>` to specify alternative port
