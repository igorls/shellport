---
title: Basic Usage
description: Complete reference for all ShellPort CLI options with examples
---

# Basic Usage

This page documents all command-line options available when running the ShellPort server.

## Quick Reference

```bash
shellport server                    # Full security — encrypted + TOTP 2FA (default)
shellport server --port 8080        # Custom port
shellport server --secret KEY      # Fixed encryption secret
shellport server --no-totp         # Encrypted only, skip TOTP
shellport server --no-secret       # TOTP only (no encryption)
shellport server --no-secret --no-totp  # Plaintext mode
shellport server --totp-reset      # Regenerate TOTP pairing secret
shellport server --no-approval     # Disable connection approval
shellport server --dev             # Allow localhost origin bypass
shellport server --tailscale serve # Expose via Tailscale serve
shellport server --tailscale funnel  # Expose via Tailscale funnel
shellport server --quiet           # Suppress non-essential output
```

## All CLI Options

### `--port`, `-p`

**Description:** Server port to listen on.

**Default:** `7681`

**Example:**
```bash
shellport server --port 8080
```

---

### `--secret`, `-s`

**Description:** Fixed encryption secret. When omitted, a random 128-bit secret is auto-generated per session.

**Default:** *(auto-generated)*

**Example:**
```bash
shellport server --secret my-secret-key
```

::: tip
It's recommended to let ShellPort auto-generate the secret. The secret is passed via URL fragment (`#secret`) and is never sent to the server.
:::

---

### `--no-secret`

**Description:** Disable encryption entirely (plaintext mode). Use this when you don't need E2E encryption and are running over a VPN like Tailscale.

**Default:** *(off — encryption enabled)*

**Example:**
```bash
shellport server --no-secret
```

::: warning
Without encryption, all terminal data is transmitted in plaintext. Only use this on trusted networks.
:::

---

### `--no-totp`

**Description:** Disable TOTP two-factor authentication. The connection will still be encrypted if no secret is set.

**Default:** *(off — TOTP enabled)*

**Example:**
```bash
shellport server --no-totp
```

---

### `--totp-reset`

**Description:** Regenerate the TOTP pairing secret. Use this if you need to re-pair your authenticator app.

**Default:** *(off)*

**Example:**
```bash
shellport server --totp-reset
```

This will delete the existing TOTP secret from `~/.shellport-totp-secret` and generate a new QR code on next startup.

---

### `--no-approval`

**Description:** Disable interactive connection approval prompts. The server host won't be asked to approve each connection.

**Default:** *(off — approval required)*

**Example:**
```bash
shellport server --no-approval
```

---

### `--dev`, `--allow-localhost`

**Description:** Allow localhost origin bypass for WebSocket connections. This relaxes origin validation for local development.

**Default:** *(off — strict origin enforcement)*

**Example:**
```bash
shellport server --dev
```

::: warning
Never use this flag in production or on exposed servers.
:::

---

### `--tailscale`

**Description:** Enable Tailscale integration. Accepts `serve` or `funnel` mode.

**Default:** *(disabled)*

**Values:**
- `serve` — Expose the server through your Tailscale network
- `funnel` — Expose the server to the public internet via Tailscale Funnel

**Example:**
```bash
# Expose via Tailscale network
shellport server --tailscale serve

# Expose to public internet
shellport server --tailscale funnel
```

See the [Tailscale Integration](/shellport/guides/tailscale) guide for full details.

---

### `--quiet`, `-q`

**Description:** Suppress non-essential output such as the TOTP secret loading message.

**Default:** *(off — all output shown)*

**Example:**
```bash
shellport server --quiet
```

---

## Environment Variables

| Variable | Description |
|---|---|
| `SHELLPORT_SECRET` | Fixed encryption key (avoids exposing in `ps`) |
| `SHELLPORT_APPROVAL_MODE` | Set to `disabled` to skip approval prompts |

---

## Security Modes

By combining flags, you can choose between four security modes:

| Mode | Flags | Encryption | TOTP | Use Case |
|------|-------|------------|------|----------|
| **Full security** | *(none)* | ✅ AES-256-GCM | ✅ | Default — maximum security |
| **Encrypted only** | `--no-totp` | ✅ AES-256-GCM | ❌ | Trusted environment |
| **TOTP only** | `--no-secret` | ❌ | ✅ | Remote via VPN/Tailscale |
| **Plaintext** | `--no-secret --no-totp` | ❌ | ❌ | Localhost dev only |

See the [Security](/shellport/guides/security) guide for full details on each mode.

---

## Common Usage Patterns

### Default secure server
```bash
shellport server
```

### Tailscale public access
```bash
shellport server --tailscale funnel
```

### Development with relaxed security
```bash
shellport server --dev --no-totp --no-approval
```

### Single-flag Tailscale serve
```bash
shellport server --tailscale serve
```
