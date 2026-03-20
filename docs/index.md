---
layout: home
title: ShellPort
titleTemplate: false

hero:
  name: ShellPort
  text: Encrypted terminal bridge
  tagline: Zero-dependency · E2E AES-256-GCM · TOTP 2FA · Built-in web UI
  image:
    src: /shellport/logo.png
    alt: ShellPort
  actions:
    - theme: brand
      text: Get Started
      link: /shellport/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/igorls/shellport

features:
  - title: E2E Encryption
    details: AES-256-GCM with PBKDF2 key derivation. Secret passed via URL fragment — never sent to the server.
  - title: TOTP 2FA
    details: RFC 6238 time-based one-time passwords. Compatible with Google Authenticator, Authy, and 1Password.
  - title: Zero Dependencies
    details: Single binary, no node_modules at runtime. ~2,400 lines of TypeScript + JavaScript total.
  - title: NanoTermV2
    details: Custom Canvas2D terminal emulator (~50 KB, zero dependencies). VT100/VT220/xterm support.
  - title: Multi-Session Tabs
    details: tmux-style sidebar for multiple PTY sessions. Switch between sessions seamlessly.
  - title: Tailscale Ready
    details: Built-in serve/funnel integration. One flag for public HTTPS via Tailscale.
---
