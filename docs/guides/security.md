---
title: Security
description: Understanding ShellPort's four security modes and when to use each
---

# Security

ShellPort provides four security modes that balance encryption, authentication, and ease of use. Choose the mode that fits your network environment and trust model.

## Overview

| Mode | Command | Auth | Encryption | Use Case |
|------|---------|------|------------|----------|
| **Full security** | `shellport server` | Secret + TOTP | AES-256-GCM | Default — maximum security |
| **Encrypted only** | `shellport server --no-totp` | URL secret | AES-256-GCM | Trusted environment |
| **TOTP only** | `shellport server --no-secret` | TOTP code | None* | Remote via VPN/Tailscale |
| **Plaintext** | `shellport server --no-secret --no-totp` | None | None | Localhost dev only |

\* When using TOTP-only mode over Tailscale/WireGuard, the VPN tunnel provides encryption at the network layer.

---

## Full Security (Default)

```bash
shellport server
```

### What it does

- **Encryption:** AES-256-GCM with per-session key derivation
- **Authentication:** 128-bit auto-generated secret + TOTP 2FA
- **Approval:** Interactive prompt to approve each connection

### When to use

This is the **recommended mode for production use**. Use it when:

- The server is accessible from the internet
- You need the highest level of security
- Multiple users will be connecting
- You're unsure which mode to choose

### How it works

1. Server generates a random 128-bit secret
2. Share the secret via the URL fragment (`#secret`)
3. User scans the QR code to pair their authenticator app
4. On each connection, both secret and TOTP code are verified

---

## Encrypted Only

```bash
shellport server --no-totp
```

### What it does

- **Encryption:** AES-256-GCM with auto-generated secret
- **Authentication:** URL secret only
- **Approval:** Interactive prompt (if not disabled)

### When to use

Use this mode when:

- You're on a trusted network (e.g., home LAN, corporate VPN)
- TOTP is too cumbersome for frequent reconnections
- You want encryption without the overhead of 2FA

### Security considerations

The secret is 128 bits and auto-generated per session, making brute-force attacks computationally infeasible. However, without TOTP, anyone who obtains the URL (including the secret in the fragment) can connect.

---

## TOTP Only

```bash
shellport server --no-secret
```

### What it does

- **Encryption:** None (plaintext)
- **Authentication:** TOTP 2FA code only
- **Approval:** Interactive prompt (if not disabled)

### When to use

Use this mode when:

- You're connected via a VPN that provides network-level encryption (Tailscale, WireGuard)
- You want simple access with 2FA protection
- The VPN ensures no one can eavesdrop on the connection

### Security considerations

Without a VPN, all terminal traffic is visible in plaintext. Only use this mode when running over an encrypted tunnel like Tailscale. The TOTP secret is stored in `~/.shellport-totp-secret`.

---

## Plaintext

```bash
shellport server --no-secret --no-totp
```

### What it does

- **Encryption:** None
- **Authentication:** None
- **Approval:** Interactive prompt (if not disabled)

### When to use

Use this mode **only** when:

- Running on `localhost` for local development
- The server is on an isolated network with no external access
- You need the simplest possible setup for testing

::: danger
This mode provides no security. All terminal data is transmitted in plaintext and there is no authentication. Never use this on any server accessible from the internet or on untrusted networks.
:::

---

## Security Layers

### Encryption

| Parameter | Value |
|-----------|-------|
| Algorithm | AES-256-GCM |
| Key Derivation | PBKDF2 · 100,000 iterations · SHA-256 |
| IV | 12-byte random nonce per message |
| Secret Size | 128 bits (16 bytes) |

### Authentication

| Method | Description |
|--------|-------------|
| URL Fragment | Secret passed via `#secret` — never sent to server |
| TOTP | RFC 6238 — SHA-1, 6 digits, 30-second window |
| Proof-of-Key | Client must decrypt a server nonce to prove key possession |

### Connection Security

| Feature | Description |
|---------|-------------|
| Rate Limiting | 5 connection attempts per IP per minute |
| Session Cap | Maximum 10 concurrent PTY sessions |
| Origin Validation | WebSocket accepts same-origin only (localhost bypass requires `--dev`) |

---

## Best Practices

1. **Keep TOTP enabled** — It's on by default for a reason
2. **Use approval mode** — The interactive approval prompt adds an extra layer of security
3. **Never use plaintext mode** on exposed servers
4. **Use `--no-secret` only with VPN** — Tailscale provides network-layer encryption
5. **Protect `~/.shellport-totp-secret`** — This file contains your TOTP pairing secret

For more details on the cryptographic implementation, see the [Security Model](/shellport/internals/security) page.
