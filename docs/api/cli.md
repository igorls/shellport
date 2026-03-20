# CLI Reference

Complete reference for the ShellPort command-line interface.

## Commands

### `shellport server`

Starts a PTY WebSocket server with optional TOTP 2FA.

```bash
shellport server [options]
```

#### Options

| Flag | Short | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--port` | `-p` | `number` | `7681` | Port to listen on |
| `--secret` | `-s` | `string` | _(auto-generated)_ | Fixed encryption secret |
| `--no-secret` | | `boolean` | `false` | Disable encryption (plaintext mode) |
| `--no-totp` | | `boolean` | `false` | Disable TOTP 2FA authentication |
| `--totp-reset` | | `boolean` | `false` | Regenerate TOTP secret (re-pair authenticator) |
| `--no-approval` | | `boolean` | `false` | Disable interactive connection approval |
| `--allow-localhost` | `--dev` | `boolean` | `false` | Allow localhost origin bypass (dev mode) |
| `--tailscale` | | `serve \| funnel` | _(none)_ | Tailscale integration |
| `--quiet` | `-q` | `boolean` | `false` | Suppress non-essential output |

#### Examples

```bash
# Start with full security — TOTP + auto-generated encryption (recommended)
shellport server

# Start without TOTP (encryption only)
shellport server --no-totp

# Re-pair authenticator app
shellport server --totp-reset

# Dev mode with localhost bypass
shellport server --dev

# Plaintext mode (trusted network only)
shellport server --no-secret --no-totp

# Public via Tailscale Funnel
shellport server --tailscale funnel

# Custom port
shellport server --port 9090

# Fixed encryption secret
shellport server --secret my-secret-key
```

---

### `shellport client`

Connects to a ShellPort server via WebSocket from the terminal.

```bash
shellport client <url> [options]
```

#### Arguments

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `url` | `string` | Yes | WebSocket URL of the server |

#### Options

| Flag | Short | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--secret` | `-s` | `string` | _(none)_ | Encryption secret for authenticated sessions |

#### Examples

```bash
# Connect with encryption
shellport client ws://host:7681/ws --secret <secret>

# Connect to localhost
shellport client ws://localhost:7681/ws
```

---

### `shellport --version`

Shows the installed version.

```bash
shellport --version
```

Output: `shellport v0.2.0`

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SHELLPORT_SECRET` | Fixed encryption secret (alternative to `--secret`, avoids exposing in process list) |
| `SHELLPORT_APPROVAL_MODE` | Set to `disabled` to disable approval mode when `--no-approval` is not set |

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Normal exit (connection closed) |
| `1` | Usage error (missing URL, invalid flag) |
| `1011` | PTY spawn failed (unsupported shell, permission error) |

---

## Protocol Details

### Handshake (Encrypted Mode)

1. Server sends `server_nonce` (16 bytes)
2. Client sends `client_nonce` (16 bytes)
3. Both derive per-session salt: `SHA-256(server_nonce || client_nonce || "shellport-v2")`
4. Key derived using `PBKDF2(secret, session_salt)`
5. If TOTP enabled: server sends `TOTP_CHALLENGE`, client responds with `TOTP_RESPONSE`
6. Encrypted communication begins

### Frame Types

| Type | Value | Description |
|------|-------|-------------|
| `DATA` | `0x00` | Terminal data |
| `CLIENT_NONCE` | `0x01` | Client nonce exchange |
| `CONTROL` | `0x02` | Resize and control messages |
| `TOTP_CHALLENGE` | `0x03` | TOTP authentication challenge |
| `TOTP_RESPONSE` | `0x04` | TOTP authentication response |

---

## Security

By default, connections require TOTP 2FA from an authenticator app. On first launch, a QR code is displayed for pairing with Authy, Google Authenticator, 1Password, etc. The secret is persisted in `~/.shellport/`.

Per-session cryptographic salts prevent precomputation attacks. Origin header validation is strict by default. Use `--allow-localhost` for local development.
