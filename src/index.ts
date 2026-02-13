#!/usr/bin/env bun
/**
 * ShellPort - CLI Entry Point
 *
 * Zero-dependency encrypted terminal bridge with built-in web UI.
 */

import { startServer } from "./server.js";
import { connectClient } from "./client.js";
import { generateSecret } from "./crypto.js";

export const VERSION = "0.1.0";

export interface ParsedArgs {
    command: string;
    port: number;
    secret: string;
    tailscale: string;
    url: string;
    noSecret: boolean;
}

/** Parse CLI arguments into a structured object. */
export function parseArgs(argv: string[]): ParsedArgs {
    const command = argv[0] || "help";
    let port = 7681;
    let secret = "";
    let tailscale = "";
    let url = "";
    let noSecret = false;

    for (let i = 1; i < argv.length; i++) {
        if (argv[i] === "--port" || argv[i] === "-p") {
            port = parseInt(argv[++i], 10);
        } else if (argv[i] === "--secret" || argv[i] === "-s") {
            secret = argv[++i];
        } else if (argv[i] === "--no-secret") {
            noSecret = true;
        } else if (argv[i] === "--tailscale") {
            tailscale = argv[++i];
        } else if (!argv[i].startsWith("--")) {
            url = argv[i];
        }
    }

    return { command, port, secret, tailscale, url, noSecret };
}

const parsed = parseArgs(process.argv.slice(2));

if (parsed.command === "server" || parsed.command === "serve") {
    let secret = parsed.secret || process.env.SHELLPORT_SECRET || "";
    const secretExplicit = !!parsed.secret;

    // Auto-generate a random secret if none provided
    if (!secret && !parsed.noSecret) {
        secret = generateSecret();
        console.log(`[ShellPort] 🎲 Auto-generated session secret (not persisted)`);
    }

    if (secretExplicit) {
        console.log(`[ShellPort] ⚠️  Using fixed secret. Auto-generated secrets (the default) are recommended for better security.`);
    }

    startServer({ port: parsed.port, secret, tailscale: parsed.tailscale });
} else if (parsed.command === "client" || parsed.command === "connect") {
    connectClient({ url: parsed.url, secret: parsed.secret });
} else if (parsed.command === "--version" || parsed.command === "-v") {
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

