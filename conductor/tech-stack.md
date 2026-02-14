# Tech Stack - ShellPort

## Core Runtime & Language
- **Runtime:** [Bun](https://bun.sh/) (>= 1.0.0) - Chosen for its native PTY support, high-performance HTTP/WebSocket server, and single-binary compilation capabilities.
- **Language:** TypeScript (ESNext) - Provides type safety for complex cryptographic and terminal-emulation logic.

## Frontend Architecture
- **Terminal Emulator:** **NanoTermV2** - A custom, zero-dependency Canvas2D renderer. It avoids the DOM overhead of traditional emulators (like xterm.js) to keep the binary small (~50KB) and rendering fast.
- **UI Logic:** Vanilla JavaScript & CSS - Strictly no frameworks (React/Vue/etc.) to maintain the "zero dependency" promise and simplify the inlining build process.
- **Asset Pipeline:** Custom build script (`src/frontend/build.ts`) that inlines all HTML, CSS, and JS into a single TypeScript string for the server to serve.

## Backend & Connectivity
- **Server:** Native `Bun.serve` for handling both HTTP and WebSocket connections.
- **Terminal Interface:** Native `Bun.spawn` with PTY support for low-latency shell interaction.
- **Protocol:** Binary-framed WebSockets with a custom sequencing queue (`SeqQueue`) to ensure ordered delivery of terminal sequences over lossy networks.

## Security Stack
- **Encryption:** AES-256-GCM (Authenticated Encryption) using the Web Crypto API.
- **Key Derivation:** PBKDF2 with SHA-256 (100,000 iterations).
- **2FA:** TOTP (RFC 6238) implemented without external libraries.
- **Networking:** Optional Tailscale integration for secure NAT traversal and public HTTPS via Funnel.

## Development & Build Tools
- **Package Manager:** Bun (for dependencies and scripts).
- **Testing:** `bun test` for unit and integration testing.
- **Static Analysis:** `tsc` for type checking.
- **Cross-Compilation:** Custom script (`scripts/build-binaries.ts`) targeting Linux, macOS, and Windows.
