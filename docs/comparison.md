---
title: Comparison
description: Feature comparison between ShellPort and other terminal sharing tools like ttyd, GoTTY, sshx, tmate, and Upterm.
---

# Comparison

How does ShellPort stack up against other terminal-sharing tools?

## Core

| | ShellPort | ttyd | GoTTY | sshx | tmate | Upterm |
|:--|:--:|:--:|:--:|:--:|:--:|:--:|
| **E2E Encryption** | ✅ AES-256 | ❌ | ❌ | ✅ Argon2 | ✅ SSH | ✅ SSH |
| **2FA (TOTP)** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Web UI** | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Multi-Session** | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ |
| **CLI Client** | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ |
| **Zero Deps** | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ |
| **Single Binary** | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |

## Extras

| | ShellPort | ttyd | GoTTY | sshx | tmate | Upterm |
|:--|:--:|:--:|:--:|:--:|:--:|:--:|
| **Collaboration** | — | — | — | ✅ Live cursors | ✅ Shared | ✅ Shared |
| **File Transfer** | — | ✅ ZMODEM | — | — | — | ✅ SFTP |
| **NAT Traversal** | ✅ Tailscale | — | — | ✅ Relay | ✅ Relay | ✅ Rev. SSH |
| **Language** | TS (Bun) | C | Go | Rust | C | Go |
| **Terminal** | Canvas2D | xterm.js | hterm | WASM | tmux | SSH |
| **Active** | ✅ | ✅ | ⚠️ | ✅ | ✅ | ⚠️ |

## When to pick what

- **ShellPort** — You want encrypted terminal sharing with the smallest footprint and zero dependencies. Great for DevOps, SSH-less remote access, and embedding a terminal in your own app via NanoTermV2.

- **ttyd** — You need a battle-tested, high-performance web terminal with file transfer support. Best for kiosk/dashboard terminals.

- **sshx** — You need real-time collaboration with multiple people (live cursors, chat). Best for pair programming and live demos.

- **tmate** — You need instant tmux-style session sharing with SSH clients. Best for pair debugging when both parties use a terminal.

- **Upterm** — You need SSH-based session sharing that works behind NATs. Best for CI/CD debugging and remote pairing.

- **Wetty** — You need a web frontend to an existing SSH server. Best for web-based SSH access to existing infrastructure.
