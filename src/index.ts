#!/usr/bin/env bun
/**
 * ShellPort - CLI Entry Point
 *
 * Zero-dependency encrypted terminal bridge with built-in web UI.
 */

import { startServer } from "./server.js";
import { connectClient } from "./client.js";
import { generateSecret } from "./crypto.js";

const VERSION = "0.1.0";

const args = process.argv.slice(2);
const command = args[0] || "help";

let port = 7681;
let secret = process.env.SHELLPORT_SECRET || "";
let tailscale = "";
let url = "";
let noSecret = false;
let secretExplicit = false;

for (let i = 1; i < args.length; i++) {
    if (args[i] === "--port" || args[i] === "-p") {
        port = parseInt(args[++i], 10);
    } else if (args[i] === "--secret" || args[i] === "-s") {
        secret = args[++i];
        secretExplicit = true;
    } else if (args[i] === "--no-secret") {
        noSecret = true;
    } else if (args[i] === "--tailscale") {
        tailscale = args[++i];
    } else if (!args[i].startsWith("--")) {
        url = args[i];
    }
}

if (command === "server" || command === "serve") {
    // Auto-generate a random secret if none provided
    if (!secret && !noSecret) {
        secret = generateSecret();
        console.log(`[ShellPort] 🎲 Auto-generated session secret (not persisted)`);
    }

    if (secretExplicit) {
        console.log(`[ShellPort] ⚠️  Using fixed secret. Auto-generated secrets (the default) are recommended for better security.`);
    }

    startServer({ port, secret, tailscale });
} else if (command === "client" || command === "connect") {
    connectClient({ url, secret });
} else if (command === "--version" || command === "-v") {
    console.log(`shellport v${VERSION}`);
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
    --tailscale <serve|funnel>  Tailscale integration

  Environment:
    SHELLPORT_SECRET         Fixed encryption secret (avoids exposing in ps)

  By default, the server generates a random secret on each launch and
  prints it to the console. Use --no-secret to run without encryption.

  Examples:
    # Start with auto-generated secret (recommended)
    shellport server

    # Start with a fixed secret
    shellport server --secret your-secret-here

    # Plaintext mode (trusted network only)
    shellport server --no-secret

    # Public via Tailscale Funnel
    shellport server --tailscale funnel

    # Connect from another machine
    shellport client ws://host:7681/ws --secret <secret>

    # Open in browser
    # http://localhost:7681/#<secret>
`);
}
