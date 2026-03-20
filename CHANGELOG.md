# Changelog

All notable changes to ShellPort will be documented in this file.

## [0.2.0] — Unreleased

### Added
- TOTP 2FA + QR code authentication (RFC 6238)
- Support `--totp`, `--no-totp`, and `--totp-reset` CLI flags
- Support `--dev` flag for localhost origin bypass
- Windows compatibility for test server (using piped stdin/stdout and cmd.exe)

### Changed
- NanoTermV2 terminal emulator split into clean ES modules (`constants.js`, `canvas-renderer.js`, `index.js`)
- Replaced `Array<Array<Cell>>` buffer with packed `Uint32Array` (16-byte truecolor cells) for zero-copy GPU migration
- Extracted `CanvasRenderer` class from NanoTermV2
- Bundled frontend output via `Bun.build()` into IIFE
- Default behavior now has TOTP enabled by default

### Fixed
- WebSocket subprotocol mismatch (RFC 6455 violation)
- CLIENT_NONCE frame type mismatch
- Client nonce extraction off-by-one in session key derivation

## [0.1.0] — 2026-02-13

### Added
- Initial release
- PTY WebSocket server with native Bun terminal API
- CLI client with raw mode and resize forwarding
- Built-in web terminal (NanoTermV2) — zero-dependency canvas renderer
- E2E AES-256-GCM encryption (optional)
- Multi-session support with tmux-style sidebar
- Full VT100/VT220/xterm emulation (256-color, truecolor, alternate screen)
- Text selection with clipboard integration
- Scrollback buffer (configurable, default 10,000 lines)
- Mouse tracking (X10, VT200, SGR)
- Tailscale integration (serve/funnel)
- Cross-platform binary builds via `bun build --compile`
- NanoTermV2 available as standalone library via `shellport/nanoterm`
