---
layout: home
title: ShellPort
titleTemplate: false

hero:
  name: ShellPort
  text: Encrypted terminal-over-the-web in a single binary
  tagline: Zero-dependency · E2E AES-256-GCM · TOTP 2FA · Built-in canvas terminal · Tailscale ready
  image:
    src: /logo.png
    alt: ShellPort
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started/installation
    - theme: alt
      text: View on GitHub
      link: https://github.com/igorls/shellport
      target: _blank

features:
  - title: Zero Dependencies
    details: Single binary, no node_modules at runtime. ~2,400 lines of TypeScript + JavaScript total.
  - title: E2E Encryption
    details: AES-256-GCM with PBKDF2 key derivation. Secret passed via URL fragment — never sent to the server.
  - title: TOTP 2FA
    details: RFC 6238 time-based one-time passwords. Compatible with Google Authenticator, Authy, and 1Password.
  - title: Canvas Terminal
    details: Custom Canvas2D terminal emulator (~50 KB, zero dependencies). VT100/VT220/xterm support.
  - title: Multi-Session
    details: tmux-style sidebar for multiple PTY sessions. Switch between sessions seamlessly.
  - title: Tailscale
    details: Built-in serve/funnel integration. One flag for public HTTPS via Tailscale.
---
