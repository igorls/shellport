# Changelog

All notable changes to ShellPort will be documented in this file.

## [0.1.0] — Unreleased

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
