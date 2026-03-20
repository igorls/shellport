# Quick Start

This guide walks you through your first session with ShellPort, from starting the server to connecting to your terminal from a browser.

## Step 1: Start the Server

Run the `server` command:

```bash
shellport server
```

On first launch, you'll see output similar to:

```
🌐 Open in browser: http://localhost:7681/#<random-secret>
```

ShellPort will also display a QR code for TOTP 2FA pairing (if this is your first time or TOTP has been reset).

## Step 2: Open the Web Terminal

1. Open the URL in your browser (the secret is embedded in the URL fragment after `#`)
2. If this is your first session, you'll be prompted to scan the QR code with your authenticator app (Google Authenticator, Authy, 1Password, etc.)
3. Enter the 6-digit code from your authenticator app to complete authentication

## Default Security Settings

ShellPort ships with security enabled by default:

| Setting | Default | Description |
|---------|---------|-------------|
| **Encryption** | Enabled | AES-256-GCM E2E encryption with auto-generated secret |
| **TOTP 2FA** | Enabled | Time-based one-time password required on first login |
| **Approval Mode** | Enabled | Server host must approve each connection |

### Understanding the URL

The URL contains your session secret after the `#` fragment:

```
http://localhost:7681/#<random-secret>
```

::: warning
The secret in the URL fragment is never sent to the server — it stays in your browser. This is by design for E2E encryption.
:::

## Step 3: Approve the Connection (First Time)

When a client connects for the first time, the server displays an approval prompt:

```
[?] Allow connection from 192.168.1.x? (y/n)
```

Type `y` to approve. The client will then complete the TOTP authentication.

## Step 4: Use the Terminal

Once connected, you'll see the terminal interface. You can:

- Type commands as normal
- Open new tabs with the `+` button in the sidebar
- Switch between sessions via the sidebar
- Resize the terminal by dragging the window

## Security Modes

If you want to adjust security settings:

```bash
# Encrypted only, skip TOTP (trusted network)
shellport server --no-totp

# TOTP only, no encryption (over VPN/Tailscale)
shellport server --no-secret

# No security (localhost only)
shellport server --no-secret --no-totp
```

::: danger
Only disable security features on trusted networks. The defaults (encryption + TOTP + approval) are recommended for production use.
:::

## Next Steps

- Learn about all available options in the [Basic Usage](../guides/basic-usage.md) guide
- Configure Tailscale for public access in the [Tailscale](../guides/tailscale.md) guide
- Understand the security model in [Security](../guides/security.md)
