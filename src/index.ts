#!/usr/bin/env bun
/**
 * ShellPort - CLI Entry Point
 *
 * Zero-dependency encrypted terminal bridge with built-in web UI.
 */

import { startServer } from './server.js'
import { connectClient } from './client.js'
import { generateSecret } from './crypto.js'
import {
  generateTOTPSecret,
  loadTOTPSecret,
  saveTOTPSecret,
  deleteTOTPSecret,
  buildOTPAuthURI,
} from './totp.js'
import { printQR } from './qr.js'

export const VERSION = '0.2.0'

export interface ParsedArgs {
  command: string
  port: number
  secret: string
  tailscale: string
  url: string
  noSecret: boolean
  requireApproval: boolean
  allowLocalhost: boolean
  quiet: boolean
  totp: boolean
  totpReset: boolean
}

/** Parse CLI arguments into a structured object. */
export function parseArgs(argv: string[]): ParsedArgs {
  const command = argv[0] || 'help'
  let port = 7681
  let secret = ''
  let tailscale = ''
  let url = ''
  let noSecret = false
  let requireApproval = true
  let allowLocalhost = false
  let quiet = false
  let totp = true
  let totpReset = false

  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--port' || argv[i] === '-p') {
      port = parseInt(argv[++i], 10)
    } else if (argv[i] === '--secret' || argv[i] === '-s') {
      secret = argv[++i]
    } else if (argv[i] === '--no-secret') {
      noSecret = true
    } else if (argv[i] === '--tailscale') {
      tailscale = argv[++i]
    } else if (argv[i] === '--no-approval') {
      requireApproval = false
    } else if (argv[i] === '--no-totp') {
      totp = false
    } else if (argv[i] === '--totp-reset') {
      totpReset = true
    } else if (argv[i] === '--allow-localhost' || argv[i] === '--dev') {
      allowLocalhost = true
    } else if (argv[i] === '--quiet' || argv[i] === '-q') {
      quiet = true
    } else if (!argv[i].startsWith('--')) {
      url = argv[i]
    }
  }

  return {
    command,
    port,
    secret,
    tailscale,
    url,
    noSecret,
    requireApproval,
    allowLocalhost,
    quiet,
    totp,
    totpReset,
  }
}

const parsed = parseArgs(process.argv.slice(2))

if (parsed.command === 'server' || parsed.command === 'serve') {
  let secret = parsed.secret || process.env.SHELLPORT_SECRET || ''
  const secretExplicit = !!parsed.secret

  if (!secret && !parsed.noSecret) {
    secret = generateSecret()
    if (!parsed.quiet) {
      console.log(`[ShellPort] 🎲 Auto-generated session secret (not persisted)`)
      console.log(`[ShellPort] 🌐 Open in browser: http://localhost:${parsed.port}/#${secret}`)
    }
  }

  if (secretExplicit && !parsed.quiet) {
    console.log(
      `[ShellPort] ⚠️  Using fixed secret. Auto-generated secrets (the default) are recommended for better security.`
    )
  }

  // ─── TOTP Setup ───
  let totpSecret: string | undefined

  if (parsed.totp) {
    // Handle --totp-reset
    if (parsed.totpReset) {
      deleteTOTPSecret()
      console.log('[ShellPort] 🔄 TOTP secret reset. A new pairing will be generated.')
    }

    // Load or generate TOTP secret
    const existing = loadTOTPSecret()
    if (existing) {
      totpSecret = existing
      if (!parsed.quiet) {
        console.log('[ShellPort] 🔐 TOTP 2FA active (already paired)')
      }
    } else {
      totpSecret = generateTOTPSecret()
      saveTOTPSecret(totpSecret)

      if (!parsed.quiet) {
        console.log('')
        console.log('  ┌─────────────────────────────────────────────────────┐')
        console.log('  │   🔐 TOTP 2FA Setup — Scan with Authenticator App   │')
        console.log('  └─────────────────────────────────────────────────────┘')

        const uri = buildOTPAuthURI(totpSecret)
        printQR(uri)

        console.log(`  Manual entry key: ${totpSecret}`)
        console.log(`  Algorithm: SHA1 | Digits: 6 | Period: 30s`)
        console.log('')
        console.log("  After pairing, this QR code won't be shown again.")
        console.log('  Use --totp-reset to generate a new secret.')
        console.log('')
      }
    }
  }

  startServer({
    port: parsed.port,
    secret,
    tailscale: parsed.tailscale,
    requireApproval: parsed.requireApproval,
    allowLocalhost: parsed.allowLocalhost,
    totp: parsed.totp,
    totpSecret,
  })
} else if (parsed.command === 'client' || parsed.command === 'connect') {
  connectClient({ url: parsed.url, secret: parsed.secret })
} else if (parsed.command === '--version' || parsed.command === '-v') {
  console.log(`shellport v${VERSION}`)
} else {
  console.log(`
  ┌─────────────────────────────────────────┐
  │   ShellPort v${VERSION}                      │
  │   Encrypted terminal bridge             │
  └─────────────────────────────────────────┘

  Usage:
    shellport server [options]     Start a PTY WebSocket server
    shellport client <url> [opts]  Connect to a server from CLI
    shellport --version            Show version

  Server Options:
    --port, -p <n>           Port (default: 7681)
    --secret, -s <key>       Fixed encryption secret (auto-generated if omitted)
    --no-secret              Disable encryption entirely (plaintext mode)
    --no-totp                Disable TOTP 2FA authentication
    --totp-reset             Regenerate TOTP secret (re-pair authenticator)
    --no-approval            Disable interactive connection approval (legacy)
    --allow-localhost, --dev Allow localhost origin bypass (dev mode)
    --tailscale <serve|funnel>  Tailscale integration
    --quiet, -q              Suppress non-essential output

  Environment:
    SHELLPORT_SECRET         Fixed encryption secret (avoids exposing in ps)

  Security:
    By default, connections require TOTP 2FA from an authenticator app.
    On first launch, a QR code is displayed for pairing with Authy, Google
    Authenticator, 1Password, etc. The secret is persisted in ~/.shellport/

    Per-session cryptographic salts prevent precomputation attacks.
    Origin header validation is strict by default. Use --allow-localhost
    for local development.

  Examples:
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

    # Connect from another machine
    shellport client ws://host:7681/ws --secret <secret>

    # Open in browser
    # http://localhost:7681/#<secret>
`)
}
