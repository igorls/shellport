---
title: TOTP 2FA
description: Set up and use TOTP two-factor authentication with ShellPort
---

# TOTP 2FA

ShellPort supports RFC 6238 Time-based One-Time Password (TOTP) two-factor authentication. This adds an extra layer of security by requiring both your encryption secret and a time-based code from your authenticator app.

## How It Works

When TOTP is enabled:

1. On first run, ShellPort generates a unique pairing secret
2. A QR code is displayed in your terminal for easy pairing
3. You scan the QR code with any TOTP-compatible app
4. On each connection, you'll need both the URL secret and a 6-digit TOTP code

## Prerequisites

- Any TOTP-compatible authenticator app:
  - **Authenticator** (iOS/Android)
  - **Google Authenticator** (iOS/Android)
  - **Authy** (iOS/Android/Desktop)
  - **1Password** (includes built-in authenticator)
  - **Bitwarden** (includes built-in authenticator)

## First-Time Setup

### 1. Start ShellPort

Run the server with TOTP enabled (default):

```bash
shellport server
```

### 2. Scan the QR Code

On first run, you'll see a QR code rendered directly in your terminal:

```
[ShellPort] 🔐 TOTP 2FA is enabled
[ShellPort]    Algorithm: SHA1 | Digits: 6 | Period: 30s

    ████████████████████████████████
    ██                          ██
    ██  ████████  ████████      ██
    ██  ████████  ████████      ██
    ██  ████████  ████████      ██
    ██  ████████  ████████      ██
    ██                          ██
    ████████████████████████████████

[ShellPort] Open any authenticator app and scan the QR code above
```

### 3. Pair Your App

Open your authenticator app and scan the QR code using its built-in scanner. The app will add "ShellPort" to your list of accounts.

### 4. Enter the Code

When connecting, you'll be prompted for the 6-digit code from your authenticator:

```
[ShellPort] 🔐 Enter TOTP code: _
```

Enter the code currently displayed in your authenticator app (it changes every 30 seconds).

## Persistent Pairing

Once paired, your TOTP secret is saved to `~/.shellport-totp-secret`. This means:

- ✅ You only need to scan the QR code once
- ✅ The secret persists across server restarts
- ✅ You can connect from any browser with your authenticator

## Resetting TOTP

If you need to re-pair (new phone, authenticator reset, etc.), use the `--totp-reset` flag:

```bash
shellport server --totp-reset
```

This will:
1. Delete the existing TOTP secret from `~/.shellport-totp-secret`
2. Generate a new pairing secret on next startup
3. Display a new QR code for re-pairing

```
[ShellPort] 🔄 TOTP secret reset. A new pairing will be generated.
```

## Disabling TOTP

If you prefer to run without TOTP (e.g., on a trusted network):

```bash
shellport server --no-totp
```

This disables TOTP authentication while keeping encryption enabled.

::: tip
For trusted networks like your home LAN or corporate VPN, `--no-totp` provides a good balance of security (encryption) and convenience (no 2FA).
:::

## TOTP Without Encryption

You can also run with TOTP but no encryption:

```bash
shellport server --no-secret
```

This is useful when connected via Tailscale or WireGuard, where the VPN provides network-level encryption.

## Technical Details

| Parameter | Value |
|-----------|-------|
| Standard | RFC 6238 |
| Algorithm | SHA-1 |
| Digits | 6 |
| Period | 30 seconds |
| Secret Storage | `~/.shellport-totp-secret` |
| Compatibility | Google Authenticator, Authy, 1Password, Bitwarden |

## Security Notes

- The TOTP secret is stored in plain text in `~/.shellport-totp-secret`
- Protect this file appropriately for your security model
- If `--quiet` is used, the secret loading message is suppressed
- TOTP adds significant security but is not foolproof against all attacks

## Troubleshooting

### QR Code Not Scanning

- Ensure your authenticator app can scan QR codes (most can)
- If using 1Password or Bitwarden, use the built-in "Scan QR Code" option
- For command-line tools like `oathtool`, you can manually enter the secret

### Code Rejected

- Ensure your device's time is accurate (TOTP is time-based)
- Try the next code (codes are valid for one period before and after)
- Use `--totp-reset` to generate a new pairing

### Secret File Missing

If `~/.shellport-totp-secret` is accidentally deleted, simply run:

```bash
shellport server --totp-reset
```

to generate a new pairing secret and QR code.
