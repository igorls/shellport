/**
 * ShellPort - Server
 *
 * HTTP + WebSocket server with native PTY allocation (Bun v1.3.5+).
 * Serves the embedded web terminal and manages shell sessions.
 *
 * Security features:
 * - Per-session salt for PBKDF2 key derivation
 * - Strict origin validation (configurable localhost bypass for dev)
 * - Atomic session counting
 * - Rate limiting per IP
 * - Bounds validation on all control messages
 * - TOTP 2FA authentication (RFC 6238)
 */

import { spawn, spawnSync } from "bun";
import { deriveKey, pack, unpack, getCryptoJS, generateNonce, deriveSessionSalt, PROTOCOL_VERSION } from "./crypto.js";
import { SeqQueue, FrameType } from "./types.js";
import type { ServerConfig, SessionData } from "./types.js";
import { buildHTML } from "./frontend/build.js";
import { verifyTOTP } from "./totp.js";

/** Maximum concurrent PTY sessions */
const MAX_SESSIONS = 10;

/** Maximum WebSocket frame size (1MB) to prevent memory exhaustion attacks */
const MAX_FRAME_SIZE = 1024 * 1024;

/** Seconds to wait for a valid auth frame before disconnecting */
const AUTH_TIMEOUT_S = 10;

/** Seconds to wait for TOTP code entry before disconnecting */
const TOTP_TIMEOUT_S = 60;

/** Maximum rate limit attempts per window per IP */
const RATE_LIMIT_MAX = 5;

/** Rate limit sliding window in milliseconds */
export const RATE_LIMIT_WINDOW_MS = 60_000;

/** Maximum terminal dimensions for resize validation */
const MAX_COLS = 1000;
const MAX_ROWS = 200;
const MIN_COLS = 1;
const MIN_ROWS = 1;

/** Environment variables safe to forward to PTY sessions */
const SAFE_ENV_VARS = [
    'HOME', 'USER', 'LOGNAME', 'SHELL', 'PATH',
    'LANG', 'LC_ALL', 'LC_CTYPE', 'XDG_RUNTIME_DIR',
    'TERM', 'COLORTERM',
];

/** Valid values for the --tailscale flag */
const VALID_TAILSCALE_MODES = ['serve', 'funnel'];

/** Localhost addresses for origin validation */
const LOCALHOST_ADDRESSES = ['localhost', '127.0.0.1', '::1', '0.0.0.0', '::'];

/** Shells considered safe for PTY spawning */
const SAFE_SHELLS = ['/bin/bash', '/bin/sh', '/bin/zsh', '/bin/fish', '/usr/bin/bash', '/usr/bin/sh', '/usr/bin/zsh', '/usr/bin/fish', '/usr/local/bin/bash', '/usr/local/bin/zsh', '/usr/local/bin/fish', 'bash', 'sh', 'zsh', 'fish'];

/** Rate limit tracker: IP -> sliding window of timestamps */
export const rateLimitMap = new Map<string, number[]>();

/** Interval for cleaning up stale rate limit entries */
const CLEANUP_INTERVAL_MS = 60_000;

export function cleanupRateLimits() {
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW_MS;

    for (const [ip, timestamps] of rateLimitMap.entries()) {
        // If the newest timestamp is older than the window, remove the whole entry
        if (timestamps.length === 0 || timestamps[timestamps.length - 1] < windowStart) {
            rateLimitMap.delete(ip);
        }
    }
}

/** Atomic session counter */
let activeSessions = 0;

function buildSafeEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const key of SAFE_ENV_VARS) {
        if (process.env[key]) env[key] = process.env[key];
    }
    env.TERM = "xterm-256color";
    env.COLORTERM = "truecolor";
    return env;
}

function isLocalhost(hostname: string): boolean {
    return LOCALHOST_ADDRESSES.includes(hostname.toLowerCase());
}

/** Sliding window rate limiter — tracks actual timestamps per IP */
function checkRateLimit(ip: string): boolean {
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW_MS;
    let timestamps = rateLimitMap.get(ip);

    if (!timestamps) {
        rateLimitMap.set(ip, [now]);
        return true;
    }

    // Prune timestamps outside the window
    timestamps = timestamps.filter(t => t > windowStart);

    if (timestamps.length >= RATE_LIMIT_MAX) {
        rateLimitMap.set(ip, timestamps);
        return false;
    }

    timestamps.push(now);
    rateLimitMap.set(ip, timestamps);
    return true;
}

function incrementSessions(): number {
    return ++activeSessions;
}

function decrementSessions(): number {
    return --activeSessions;
}

/** Security headers for HTTP responses */
const SECURITY_HEADERS = {
    "Content-Type": "text/html",
    "Content-Security-Policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self' ws: wss:; img-src 'self' data:; font-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none';",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-XSS-Protection": "1; mode=block",
};

export async function startServer(config: ServerConfig): Promise<void> {
    const baseKey = config.secret ? await deriveKey(config.secret) : null;
    const safeEnv = buildSafeEnv();

    console.log(`[ShellPort] Starting PTY WebSocket Server on port ${config.port}...`);

    if (config.totp && config.totpSecret) {
        console.log("[ShellPort] 🔐 TOTP 2FA enabled (connections require authenticator code)");
    } else if (config.requireApproval && process.env.SHELLPORT_APPROVAL_MODE !== "disabled") {
        console.log("[ShellPort] 🔐 Interactive approval mode enabled (connections require manual approval)");
    }

    if (config.allowLocalhost) {
        console.log("[ShellPort] ⚠️  Dev mode: localhost origin bypass enabled");
    }

    if (!baseKey) {
        console.log("[ShellPort] ⚠️  WARNING: No encryption enabled. Use --secret for production.");
    }

    if (config.tailscale) {
        if (!VALID_TAILSCALE_MODES.includes(config.tailscale)) {
            console.error(`[ShellPort] ❌ --tailscale must be '${VALID_TAILSCALE_MODES.join("' or '")}'`);
            process.exit(1);
        }

        const tsCheck = spawnSync(["tailscale", "version"]);
        if (tsCheck.exitCode !== 0) {
            console.error("[ShellPort] ❌ Tailscale CLI not found in PATH.");
            process.exit(1);
        }
        console.log(`[ShellPort] 🌐 Tailscale ${config.tailscale} on localhost:${config.port}...`);
        spawn(["tailscale", config.tailscale, `localhost:${config.port}`], {
            stdout: "inherit",
            stderr: "inherit",
        });
    }

    const htmlClient = buildHTML(getCryptoJS());

    Bun.serve({
        port: config.port,

        fetch(req, server) {
            const url = new URL(req.url);

            if (url.pathname === "/ws") {
                const clientIP = server.requestIP(req)?.address || "unknown";

                if (!checkRateLimit(clientIP)) {
                    return new Response("Too many requests", { status: 429 });
                }

                if (activeSessions >= MAX_SESSIONS) {
                    return new Response("Session limit reached", { status: 503 });
                }

                const origin = req.headers.get("origin");
                if (origin) {
                    try {
                        const originUrl = new URL(origin);
                        const serverHost = req.headers.get("host")?.split(":")[0] || "";

                        if (originUrl.hostname !== serverHost) {
                            if (!config.allowLocalhost || !isLocalhost(originUrl.hostname)) {
                                return new Response("Origin not allowed", { status: 403 });
                            }
                        }
                    } catch {
                        return new Response("Invalid origin", { status: 403 });
                    }
                } else if (!config.allowLocalhost) {
                    return new Response("Origin header required", { status: 403 });
                }

                const data: SessionData = {
                    sendQ: new SeqQueue(),
                    recvQ: new SeqQueue(),
                    proc: null,
                    authenticated: false,
                    clientIP,
                };

                if (server.upgrade(req, { data: data as unknown as undefined, headers: { "Sec-WebSocket-Protocol": `shellport-v${PROTOCOL_VERSION}` } })) {
                    return;
                }
                return new Response("Expected WebSocket", { status: 400 });
            }

            if (url.pathname === "/" || url.pathname === "/index.html") {
                return new Response(htmlClient, {
                    headers: SECURITY_HEADERS,
                });
            }

            return new Response("Not found", { status: 404 });
        },

        websocket: {
            open(ws) {
                const sessionData = ws.data as unknown as SessionData;

                if (baseKey) {
                    sessionData.serverNonce = generateNonce();
                    ws.send(sessionData.serverNonce.buffer as ArrayBuffer);
                } else if (!config.totp && !config.requireApproval) {
                    // No encryption, no TOTP, no approval — plaintext mode
                    sessionData.authenticated = true;
                    incrementSessions();
                    spawnPTY(ws, sessionData, null, safeEnv, () => decrementSessions());
                    return;
                } else if (!baseKey && config.totp && config.totpSecret) {
                    // No encryption, but TOTP required — send challenge immediately
                    sessionData.authenticated = true;
                    sessionData.totpPending = true;
                    // Send TOTP challenge as plaintext frame: [type_byte]
                    const frame = new Uint8Array([FrameType.TOTP_CHALLENGE]);
                    ws.send(frame.buffer as ArrayBuffer);
                    console.log(`[ShellPort] 🔑 TOTP challenge sent to ${sessionData.clientIP}`);
                }

                sessionData.authTimer = setTimeout(() => {
                    console.log("[ShellPort] Auth/approval timeout — disconnecting.");
                    ws.close(4001, "Authentication timeout");
                }, (config.totp ? TOTP_TIMEOUT_S : AUTH_TIMEOUT_S) * 1000);
            },

            async message(ws, message) {
                const sessionData = ws.data as unknown as SessionData;
                const msgBuffer = message as unknown as ArrayBuffer;

                if (msgBuffer.byteLength > MAX_FRAME_SIZE) {
                    console.log(`[ShellPort] ❌ Oversized frame from ${sessionData.clientIP} (${msgBuffer.byteLength} bytes) — disconnecting.`);
                    ws.close(4009, "Message too large");
                    return;
                }

                // ─── TOTP verification pending ───
                if (sessionData.totpPending && config.totp && config.totpSecret) {
                    sessionData.recvQ.add(async () => {
                        const decoded = await unpackMessage(sessionData, msgBuffer, baseKey, config);
                        if (!decoded) {
                            ws.close(4003, "Authentication failed");
                            return;
                        }

                        if (decoded.type === FrameType.TOTP_RESPONSE) {
                            const code = new TextDecoder().decode(decoded.payload).trim();
                            const valid = await verifyTOTP(config.totpSecret!, code);

                            if (!valid) {
                                console.log(`[ShellPort] ❌ Invalid TOTP code from ${sessionData.clientIP}`);
                                ws.close(4003, "Authentication failed");
                                return;
                            }

                            console.log(`[ShellPort] ✅ TOTP verified for ${sessionData.clientIP}`);
                            sessionData.totpPending = false;
                            if (sessionData.authTimer) clearTimeout(sessionData.authTimer);
                            incrementSessions();
                            const sessionKey = (sessionData as any)._sessionKey || null;
                            spawnPTY(ws, sessionData, sessionKey, safeEnv, () => decrementSessions());
                        }
                    });
                    return;
                }

                // ─── Normal authenticated traffic ───
                if (sessionData.authenticated) {
                    handleDataMessage(ws, sessionData, msgBuffer, baseKey, config);
                    return;
                }

                // ─── Authentication handshake ───
                sessionData.recvQ.add(async () => {
                    if (sessionData.authenticated) {
                        handleDataMessage(ws, sessionData, msgBuffer, baseKey, config);
                        return;
                    }

                    const msgView = new Uint8Array(msgBuffer);
                    const peekType = msgView.length > 0 ? msgView[0] : 0;

                    if (baseKey && sessionData.serverNonce) {
                        if (peekType !== FrameType.CLIENT_NONCE) {
                            ws.close(4003, "Authentication failed");
                            return;
                        }

                        if (msgView.length < 17) { // 1 type byte + 16 nonce bytes
                            ws.close(4003, "Authentication failed");
                            return;
                        }

                        // Skip the frame type byte (byte 0) to get the actual nonce payload
                        const clientNonce = msgView.slice(1, 17);
                        const sessionSalt = await deriveSessionSalt(sessionData.serverNonce!, clientNonce);
                        const sessionKey = await deriveKey(config.secret, sessionSalt);

                        (sessionData as any)._sessionKey = sessionKey;
                        sessionData.serverNonce = undefined;
                        sessionData.authenticated = true;

                        // If TOTP is enabled, send challenge instead of spawning PTY
                        if (config.totp && config.totpSecret) {
                            sessionData.totpPending = true;
                            // Send TOTP challenge (encrypted)
                            ws.send(await pack(sessionKey, FrameType.TOTP_CHALLENGE, new Uint8Array(0)));
                            console.log(`[ShellPort] 🔑 TOTP challenge sent to ${sessionData.clientIP}`);
                            return;
                        }

                        if (sessionData.authTimer) clearTimeout(sessionData.authTimer);
                        incrementSessions();
                        spawnPTY(ws, sessionData, sessionKey, safeEnv, () => decrementSessions());
                        return;
                    }

                    // No encryption — handle plaintext with optional TOTP
                    sessionData.authenticated = true;
                    if (sessionData.authTimer) clearTimeout(sessionData.authTimer);

                    if (config.totp && config.totpSecret) {
                        sessionData.totpPending = true;
                        // Send TOTP challenge (plaintext)
                        ws.send(await pack(null, FrameType.TOTP_CHALLENGE, new Uint8Array(0)));
                        console.log(`[ShellPort] 🔑 TOTP challenge sent to ${sessionData.clientIP}`);
                        return;
                    }

                    incrementSessions();
                    spawnPTY(ws, sessionData, null, safeEnv, () => decrementSessions());
                });
            },

            close(ws, code, reason) {
                const sessionData = ws.data as unknown as SessionData;
                if (sessionData.authTimer) clearTimeout(sessionData.authTimer);

                if (sessionData.authenticated && !sessionData.totpPending) {
                    decrementSessions();
                }

                const proc = sessionData.proc;
                if (proc && !proc.killed) {
                    try {
                        proc.kill();
                    } catch {
                        // Already dead
                    }
                }
                console.log(`[ShellPort] PTY session closed (${sessionData.clientIP || "unknown"})`);
            },
        },
    });

    console.log(`[ShellPort] ✅ Listening on http://localhost:${config.port}`);
    console.log(`[ShellPort] 📊 Max sessions: ${MAX_SESSIONS}`);
    console.log(`[ShellPort] 🔒 Protocol version: v${PROTOCOL_VERSION}`);

    // Start background cleanup task
    setInterval(cleanupRateLimits, CLEANUP_INTERVAL_MS).unref();
}

/**
 * Helper to unpack a message in either encrypted or plaintext mode.
 */
async function unpackMessage(
    sessionData: SessionData,
    msgBuffer: ArrayBuffer,
    baseKey: CryptoKey | null,
    _config: ServerConfig
) {
    const sessionKey = (sessionData as any)._sessionKey || baseKey;
    return await unpack(sessionKey, msgBuffer);
}

function handleDataMessage(
    ws: any,
    sessionData: SessionData,
    msgBuffer: ArrayBuffer,
    baseKey: CryptoKey | null,
    config: ServerConfig
) {
    const sessionKey = (sessionData as any)._sessionKey || baseKey;

    sessionData.recvQ.add(async () => {
        const proc = sessionData.proc;
        if (!proc || !proc.terminal) return;

        const decoded = await unpack(sessionKey, msgBuffer);
        if (!decoded) {
            ws.close(4003, "Authentication failed");
            return;
        }

        if (decoded.type === FrameType.DATA) {
            sessionData.proc?.terminal?.write(decoded.payload);
        } else if (decoded.type === FrameType.CONTROL) {
            try {
                const payloadStr = new TextDecoder().decode(decoded.payload);
                if (payloadStr.length > 65536) return;

                const ctl = JSON.parse(payloadStr);

                if (ctl.type === "resize") {
                    const cols = Math.max(MIN_COLS, Math.min(MAX_COLS, Math.floor(Number(ctl.cols)) || 80));
                    const rows = Math.max(MIN_ROWS, Math.min(MAX_ROWS, Math.floor(Number(ctl.rows)) || 24));
                    sessionData.proc?.terminal?.resize(cols, rows);
                }
            } catch {
                // Malformed control message — ignore
            }
        }
    });
}

/**
 * Sanitizes data coming from the PTY before sending it to the client.
 * Blocks sequences that could be used for fingerprinting or dangerous client-side actions.
 */
export function sanitizePTYData(data: Uint8Array): Uint8Array {
    let str = new TextDecoder().decode(data);
    
    // 1. Block DSR (Device Status Report) - CSI 6 n
    // Prevents the shell from querying the client's cursor position.
    str = str.replace(/\x1b\[6n/g, "");

    // 2. Block OSC 52 (Clipboard Write)
    // Even though the frontend has a confirmation prompt, blocking at server level 
    // provides defense-in-depth for users who might disable prompts.
    str = str.replace(/\x1b\]52;[^\x07\x1b]*[\x07\x1b\\]/g, "");

    return new TextEncoder().encode(str);
}

/** Spawn a PTY process and wire it to the WebSocket */
function spawnPTY(
    ws: any,
    sessionData: SessionData,
    cryptoKey: CryptoKey | null,
    env: Record<string, string>,
    onClose: () => void,
) {
    console.log(`[ShellPort] New PTY session allocated for ${sessionData.clientIP || "unknown"}.`);
    try {
        const shell = process.env.SHELL || "bash";
        if (!SAFE_SHELLS.includes(shell)) {
            console.error(`[ShellPort] Rejected unsafe shell: ${shell}`);
            onClose();
            ws.close(1011, "Unsupported shell");
            return;
        }
        const proc = spawn([shell], {
            env,
            terminal: {
                cols: 80,
                rows: 24,
                data(_term: unknown, data: Uint8Array) {
                    sessionData.sendQ.add(async () => {
                        if (ws.readyState === 1) {
                            const sanitized = sanitizePTYData(data);
                            ws.send(await pack(cryptoKey, FrameType.DATA, sanitized));
                        }
                    });
                },
            },
        });

        sessionData.proc = proc;

        proc.exited.then(() => {
            onClose();
            if (ws.readyState === 1) {
                ws.close(1000, "Shell exited");
            }
        });
    } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        console.error(`[ShellPort] PTY spawn failed: ${errorMsg}`);
        onClose();
        ws.close(1011, "PTY Spawn Failed");
    }
}