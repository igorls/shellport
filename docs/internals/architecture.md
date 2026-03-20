---
outline: [2, 3]
---
# Architecture

This page documents the internal architecture of ShellPort, explaining the directory structure, component responsibilities, and the data flow between browser, server, and PTY.

## Directory Structure

ShellPort is organized into a minimal, zero-dependency codebase (~2,400 lines total):

```
src/
├── index.ts          # CLI entry — argument parsing & routing
├── server.ts         # HTTP + WebSocket + PTY server (Bun.serve)
├── client.ts         # CLI WebSocket client (raw terminal mode)
├── crypto.ts         # AES-256-GCM engine (PBKDF2 key derivation)
├── totp.ts           # TOTP 2FA (RFC 6238) — secret, QR, verify
├── qr.ts             # QR code generator (terminal-rendered)
├── types.ts          # TypeScript types, constants, SeqQueue
├── bounds.test.ts    # Input bounds validation tests
├── crypto.test.ts    # Cryptographic operation tests
├── index.test.ts     # CLI argument parsing tests
├── integration.test.ts # End-to-end flow tests
├── pty.test.ts       # PTY handling tests
├── qr.test.ts        # QR code generation tests
├── server.test.ts    # Server operation tests
├── server_ratelimit.test.ts # Rate limiting tests
└── totp.test.ts      # TOTP verification tests
```

### Frontend Directory

The frontend is bundled as a single HTML file with no external dependencies:

```
src/frontend/
├── index.html    # HTML shell (entry point)
├── styles.css    # Terminal + sidebar UI styles
├── nanoterm/     # NanoTermV2 standalone terminal library
│   ├── index.js           # NanoTermV2 terminal emulator
│   ├── canvas-renderer.js # Canvas2D backend renderer
│   └── constants.js       # Palettes, layout, utilities
├── app.js        # Session manager & UI logic
├── bundle.ts     # NanoTermV2 ES module bundler
└── build.ts      # HTML assembler (inlines all assets)
```

## Component Responsibilities

### Core Server (`server.ts`)

The server is built on Bun's native APIs and handles:

- **HTTP Server** — Serves the frontend HTML, CSS, and JavaScript bundles
- **WebSocket Server** — Manages persistent bidirectional connections with clients
- **PTY Management** — Spawns and manages pseudo-terminal processes (Bun's native `Bun.spawn` with PTY)
- **Connection Approval** — Interactive prompts for approving new connections
- **Rate Limiting** — Protects against brute-force attacks (5 attempts/IP/minute)
- **Session Management** — Tracks up to 10 concurrent PTY sessions

### Cryptographic Engine (`crypto.ts`)

Handles all encryption operations:

- **Key Derivation** — PBKDF2 with 100,000 iterations using SHA-256
- **Encryption** — AES-256-GCM authenticated encryption
- **Nonce Management** — 12-byte random IV per message
- **Salt Generation** — Per-session cryptographic salt from server and client nonces
- **Proof-of-Knowledge** — Mutual nonce exchange for authentication

### TOTP Authentication (`totp.ts`)

Implements RFC 6238 time-based one-time passwords:

- **Secret Generation** — RFC 6238 compliant secret creation
- **Code Generation** — SHA-1 based 6-digit TOTP (30-second window)
- **QR Code Rendering** — Terminal-rendered QR codes for authenticator pairing
- **Secret Persistence** — Saves paired secrets to `~/.shellport-totp-secret`
- **Verification** — Validates TOTP codes with a ±1 window for clock drift

### NanoTermV2 Terminal (`frontend/nanoterm/`)

A custom Canvas2D terminal emulator:

- **Canvas2D Rendering** — Hardware-accelerated, zero DOM nodes
- **Escape Sequence Parsing** — VT100/VT220/xterm compatibility
- **256-Color Support** — Full palette + truecolor (24-bit) support
- **Mouse Tracking** — X10, Normal, and SGR modes
- **Text Selection** — With clipboard integration (OSC 52)
- **Bracketed Paste Mode** — Safe bulk text input
- **Alternate Screen Buffer** — vim, htop, tmux support

### Frontend Application (`frontend/app.js`)

Manages the browser-side session:

- **Session Initialization** — Handles the WebSocket handshake
- **Key Derivation** — Derives encryption keys from URL fragment secret
- **Terminal Integration** — Bridges NanoTermV2 with WebSocket messages
- **UI Management** — Sidebar tabs, connection status, error handling
- **Clipboard Operations** — OSC 52 clipboard read/write with confirmation

### CLI Entry (`index.ts`)

Provides the command-line interface:

- **Argument Parsing** — Routes commands (`server`, `client`) and flags
- **Server Startup** — Initializes server with configured security mode
- **Client Connection** — Establishes WebSocket connections to remote servers
- **Security Modes** — `--no-secret`, `--no-totp`, `--no-approval`, etc.

## Data Flow Diagram

The following diagram illustrates the complete connection lifecycle, showing how data moves between the browser, server, and PTY process:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                                  BROWSER                                      │
│  ┌─────────────────┐    ┌──────────────────┐    ┌─────────────────────────┐   │
│  │   NanoTermV2    │◀──▶│   Session Mgr    │◀──▶│    WebSocket Client     │   │
│  │  (Canvas2D)     │    │    (app.js)      │    │                         │   │
│  └────────┬────────┘    └────────┬─────────┘    └────────────┬────────────┘   │
│           │                       │                            │                │
│           │                       │   ┌──────────────────────┐ │                │
│           │                       └──▶│  Key Derivation       │◀┘                │
│           │                           │  (PBKDF2 + Nonces)    │                   │
│           │                           └──────────────────────┘                   │
│           │                                    │                                │
│           │          AES-256-GCM               │                                │
│           │         [iv][ciphertext]           │                                │
└───────────┼────────────────────────────────────┼────────────────────────────────┘
            │                                    │
            │         WebSocket (binary)          │
            │        ┌──────────────┐            │
            └───────▶│              │◀───────────┘
                     │              │
            ┌────────│              │───────────┐
            │        └──────────────┘           │
            │                                    │
            ▼                                    ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                              SERVER                                           │
│  ┌────────────────┐    ┌─────────────────┐    ┌────────────────────────────┐  │
│  │  Rate Limiter  │───▶│ WebSocket       │───▶│  PTY Manager               │  │
│  │  (5/IP/min)    │    │  Handler        │    │  (Bun.spawn)               │  │
│  └────────────────┘    └────────┬────────┘    └─────────────┬──────────────┘  │
│                                  │                      │                      │
│                                  ▼                      ▼                      │
│                    ┌────────────────────────┐   ┌───────────────┐           │
│                    │  Crypto Engine          │   │ Shell Process │           │
│                    │  (AES-256-GCM)         │   │ (bash, zsh)   │           │
│                    └────────────────────────┘   └───────────────┘           │
│                                  │                      │                      │
│                                  ▼                      │                      │
│                    ┌────────────────────────┐           │                      │
│                    │  TOTP Verifier        │           │                      │
│                    │  (RFC 6238)           │           │                      │
│                    └────────────────────────┘           │                      │
└─────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                    ┌─────────────────────────────┐
                    │       PTY Process           │
                    │   (Pseudo Terminal)         │
                    │                             │
                    │   stdin ←─ terminal input  │
                    │   stdout ─── terminal      │
                    │         output             │
                    └─────────────────────────────┘
```

### Connection Flow Steps

1. **Server Nonce Exchange**
   - Server generates a random nonce and sends it to the client
   - Client incorporates this nonce into the key derivation salt

2. **Client Nonce Exchange**
   - Client generates its own random nonce and sends it to the server
   - Combined with server nonce and URL fragment secret, the session key is derived via PBKDF2

3. **Proof-of-Knowledge**
   - Server encrypts a challenge with the derived key
   - Client must decrypt and return it to prove key possession
   - This verifies both parties have the correct secret

4. **TOTP Challenge** *(if enabled)*
   - Server sends a TOTP challenge request
   - Client displays the code prompt to the user
   - User enters their authenticator code
   - Server verifies against RFC 6238 TOTP

5. **Connection Approval** *(if enabled)*
   - Server displays an interactive prompt to the terminal
   - Operator must approve the connection
   - Connection is rejected if denied or timeout

6. **WebSocket Binary Framing**
   - All terminal data is framed as binary WebSocket messages
   - Each frame: `[12-byte IV][AES-256-GCM ciphertext]`
   - IV is randomly generated per message for semantic security

7. **PTY Streaming**
   - Server reads from PTY stdout and sends to client
   - Client sends user input to server, which writes to PTY stdin
   - Terminal resize events forwarded bidirectionally

## Security Considerations

- **Secret in URL Fragment** — The encryption secret travels in the URL fragment (`#secret`), which is never sent to the server via HTTP headers
- **Origin Validation** — WebSocket connections validate origin; localhost bypass requires `--dev` flag
- **Buffer Limits** — OSC/DCS sequences capped at 64KB to prevent memory exhaustion attacks
- **Safe Environment** — Only whitelisted environment variables passed to the PTY
