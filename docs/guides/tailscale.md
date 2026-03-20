---
title: Tailscale Integration
description: Expose ShellPort publicly using Tailscale serve or funnel
---

# Tailscale Integration

ShellPort has built-in support for [Tailscale](https://tailscale.com/) — the fastest way to securely share your terminal over the internet. With a single flag, you can expose your server via your Tailscale network or even the public internet.

## Prerequisites

- [Tailscale](https://tailscale.com/download) installed and running on the server
- A Tailscale account (free tier works)
- The Tailscale CLI must be in your PATH

Verify Tailscale is installed and authenticated:

```bash
tailscale status
```

You should see your Tailscale identity and current status.

## Two Integration Modes

### Tailscale Serve

**Purpose:** Expose ShellPort to your Tailscale network only.

```bash
shellport server --tailscale serve
```

This makes ShellPort accessible to:
- ✅ Your own devices on Tailscale
- ✅ Anyone you share your Tailscale network with
- ❌ The general public internet

**Use case:** Perfect for personal use across your own devices or sharing with trusted individuals on your Tailscale tailnet.

### Tailscale Funnel

**Purpose:** Expose ShellPort to the public internet via Tailscale Funnel.

```bash
shellport server --tailscale funnel
```

This makes ShellPort accessible to:
- ✅ Anyone with the URL
- ✅ The general public internet
- ⚠️ No built-in authentication (use `--no-totp` cautiously or combine with Tailscale ACLs)

**Use case:** When you need to share your terminal with someone outside your Tailscale network, or for demos and quick collaboration.

::: warning
When using `--tailscale funnel`, your server is publicly accessible. Always use `--secret` or `--no-secret` (with TOTP) for authentication. Consider using Tailscale ACLs to restrict access.
:::

## How It Works

When you use `--tailscale serve` or `--tailscale funnel`, ShellPort:

1. Starts the HTTP/WebSocket server on `localhost:7681`
2. Uses `tailscale serve` or `tailscale funnel` to create the HTTPS reverse proxy
3. Prints the public URL for easy access

### Example Output

```
$ shellport server --tailscale serve
[ShellPort] 🌐 Starting server on localhost:7681
[ShellPort] 🔐 Tailscale serve enabled
[ShellPort] 🔗 Shareable URL: https://your-device.tail1234.ts.net/shellport/
[ShellPort] 🌐 Open in browser: https://your-device.tail1234.ts.net/shellport/#your-secret
```

For funnel mode:

```
$ shellport server --tailscale funnel
[ShellPort] 🌐 Starting server on localhost:7681
[ShellPort] 🔐 Tailscale funnel enabled
[ShellPort] 🔗 Public URL: https://your-device.example.com/shellport/
[ShellPort] 🌐 Open in browser: https://your-device.example.com/shellport/#your-secret
```

## Comparison

| Feature | `serve` | `funnel` |
|---------|---------|----------|
| Accessible from Tailscale | ✅ | ✅ |
| Accessible from internet | ❌ | ✅ |
| HTTPS provided | ✅ | ✅ |
| Requires domain | ❌ | ⚠️ |
| Auth by ShellPort | ✅ | ✅ |

## Recommended Usage

### Personal Use (Serve)

```bash
# Start with full security via Tailscale serve
shellport server --tailscale serve

# Or with TOTP only (Tailscale encrypts the connection)
shellport server --tailscale serve --no-secret
```

### Public Sharing (Funnel)

```bash
# With encryption + TOTP
shellport server --tailscale funnel

# TOTP only (Tailscale encrypts, you verify identity)
shellport server --tailscale funnel --no-secret
```

## Tailscale ACLs

For `serve` mode, you can use Tailscale Access Control Lists (ACLs) to control who can access your server. Edit your Tailscale ACL policy to allow specific users or groups to access the ShellPort service.

Example ACL policy fragment:

```json
{
  "acls": [
    {
      "action": "accept",
      "src": ["group:trusted"],
      "dst": ["*:*"]
    }
  ]
}
```

## Security Considerations

### With `--tailscale serve`

- Access is limited to your Tailscale network
- Tailscale provides the encryption layer
- Combine with `--no-secret --no-totp` for TOTP-only auth (Tailscale encrypts)

### With `--tailscale funnel`

- Server is publicly accessible
- Always use authentication:
  - `--secret` for encryption-based auth
  - `--no-secret` with TOTP for 2FA
- Consider Tailscale ACLs to restrict by source IP
- Funnel binds to port 443 automatically

## Troubleshooting

### "tailscale: command not found"

Ensure Tailscale is installed. Download from [tailscale.com/download](https://tailscale.com/download).

### "tailscale serve requires being enabled"

Run:

```bash
tailscale serve --bg
```

Or enable it in the Tailscale admin console.

### "funnel requires a domain"

Funnel needs either:
- A Tailscale Funnel domain (e.g., `device.name.ts.net`)
- A custom domain configured in Tailscale

For simple use cases, `serve` is recommended as it works with Tailscale's built-in DNS.

## Further Reading

- [Tailscale Serve documentation](https://tailscale.com/kb/1312/tailscale-serve)
- [Tailscale Funnel documentation](https://tailscale.com/kb/1224/tailscale-funnel)
- [Tailscale ACLs](https://tailscale.com/kb/1018/acls)
