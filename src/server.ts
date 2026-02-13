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
 * - Interactive connection approval mode
 */

import { spawn, spawnSync } from "bun";
import { deriveKey, pack, unpack, getCryptoJS, generateNonce, deriveSessionSalt, PROTOCOL_VERSION } from "./crypto.js";
import { SeqQueue, FrameType } from "./types.js";
import type { ServerConfig, SessionData } from "./types.js";
import { buildHTML } from "./frontend/build.js";

/** Maximum concurrent PTY sessions */
const MAX_SESSIONS = 10;

/** Seconds to wait for a valid auth frame before disconnecting */
const AUTH_TIMEOUT_S = 10;

/** Seconds to wait for approval before disconnecting */
const APPROVAL_TIMEOUT_S = 30;

/** Maximum rate limit attempts per minute per IP */
const RATE_LIMIT_MAX = 5;

/** Rate limit window in milliseconds */
const RATE_LIMIT_WINDOW_MS = 60_000;

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

/** Rate limit tracker: IP -> [timestamp, count] */
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

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

function checkRateLimit(ip: string): boolean {
    const now = Date.now();
    const entry = rateLimitMap.get(ip);
    
    if (!entry || now > entry.resetAt) {
        rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
        return true;
    }
    
    if (entry.count >= RATE_LIMIT_MAX) {
        return false;
    }
    
    entry.count++;
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
    "Content-Security-Policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self' ws: wss:; img-src 'self' data:; font-src 'self' data:; object-src 'none'; frame-ancestors 'none';",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-XSS-Protection": "1; mode=block",
};

function getApprovalFromTerminal(clientIP: string): Promise<boolean> {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            console.log("[ShellPort] Approval timeout - denied");
            process.stdin.setRawMode(false);
            process.stdin.pause();
            resolve(false);
        }, APPROVAL_TIMEOUT_S * 1000);

        process.stdin.setRawMode(true);
        process.stdin.resume();
        
        process.stdout.write(`[ShellPort] 🔔 Incoming connection from ${clientIP}. Approve? [y/N] `);
        
        const onData = (data: Buffer) => {
            clearTimeout(timeout);
            process.stdin.setRawMode(false);
            process.stdin.pause();
            process.stdin.removeListener('data', onData);
            
            const answer = data.toString().toLowerCase().trim();
            const approved = answer === 'y' || answer === 'yes';
            resolve(approved);
        };
        
        process.stdin.once('data', onData);
    });
}

export async function startServer(config: ServerConfig): Promise<void> {
    const baseKey = config.secret ? await deriveKey(config.secret) : null;
    const safeEnv = buildSafeEnv();

    console.log(`[ShellPort] Starting PTY WebSocket Server on port ${config.port}...`);

    if (config.requireApproval && process.env.SHELLPORT_APPROVAL_MODE !== "disabled") {
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
                const clientIP = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
                                 req.headers.get("x-real-ip") ||
                                 server.requestIP(req)?.address ||
                                 "unknown";

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
                } else if (!config.requireApproval) {
                    sessionData.authenticated = true;
                    incrementSessions();
                    spawnPTY(ws, sessionData, null, safeEnv, () => decrementSessions());
                    return;
                }

                sessionData.authTimer = setTimeout(() => {
                    console.log("[ShellPort] Auth/approval timeout — disconnecting.");
                    ws.close(4001, "Authentication timeout");
                }, AUTH_TIMEOUT_S * 1000);
            },

            async message(ws, message) {
                const sessionData = ws.data as unknown as SessionData;
                const msgBuffer = message as unknown as ArrayBuffer;

                if (!sessionData.authenticated) {
                    sessionData.recvQ.add(async () => {
                        if (sessionData.authenticated) {
                            handleDataMessage(ws, sessionData, msgBuffer, baseKey, config);
                            return;
                        }

                        const msgView = new Uint8Array(msgBuffer);
                        const peekType = msgView.length > 0 ? msgView[0] : 0;

                        if (baseKey && sessionData.serverNonce) {
                            if (peekType !== FrameType.CLIENT_NONCE) {
                                ws.close(4003, "Expected client nonce");
                                return;
                            }

                            if (msgView.length < 16) {
                                ws.close(4003, "Invalid client nonce");
                                return;
                            }

                            const clientNonce = msgView.slice(0, 16);

                            if (config.requireApproval && process.env.SHELLPORT_APPROVAL_MODE !== "disabled") {
                                console.log(`[ShellPort] 🔔 Connection request from: ${sessionData.clientIP}`);
                                
                                const approved = await getApprovalFromTerminal(sessionData.clientIP || "unknown");
                                
                                if (!approved) {
                                    console.log(`[ShellPort] ❌ Connection from ${sessionData.clientIP} denied`);
                                    ws.close(4003, "Connection denied by host");
                                    return;
                                }
                                console.log(`[ShellPort] ✅ Connection from ${sessionData.clientIP} approved`);
                            }

                            const sessionSalt = await deriveSessionSalt(sessionData.serverNonce!, clientNonce);
                            const sessionKey = await deriveKey(config.secret, sessionSalt);

                            (sessionData as any)._sessionKey = sessionKey;
                            sessionData.serverNonce = undefined;
                            sessionData.authenticated = true;

                            if (sessionData.authTimer) clearTimeout(sessionData.authTimer);
                            incrementSessions();
                            spawnPTY(ws, sessionData, sessionKey, safeEnv, () => decrementSessions());
                            return;
                        }

                        if (!baseKey && config.requireApproval && process.env.SHELLPORT_APPROVAL_MODE !== "disabled") {
                            console.log(`[ShellPort] 🔔 Connection request from: ${sessionData.clientIP}`);
                            const approved = await getApprovalFromTerminal(sessionData.clientIP || "unknown");
                            if (!approved) {
                                console.log(`[ShellPort] ❌ Connection from ${sessionData.clientIP} denied`);
                                ws.close(4003, "Connection denied by host");
                                return;
                            }
                            console.log(`[ShellPort] ✅ Connection from ${sessionData.clientIP} approved`);
                        }

                        sessionData.authenticated = true;
                        if (sessionData.authTimer) clearTimeout(sessionData.authTimer);
                        incrementSessions();
                        spawnPTY(ws, sessionData, null, safeEnv, () => decrementSessions());
                    });
                    return;
                }

                handleDataMessage(ws, sessionData, msgBuffer, baseKey, config);
            },

            close(ws) {
                const sessionData = ws.data as unknown as SessionData;
                if (sessionData.authTimer) clearTimeout(sessionData.authTimer);
                
                if (sessionData.authenticated) {
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
            ws.close(4003, "Decryption failed");
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
        const proc = spawn([shell], {
            env,
            terminal: {
                cols: 80,
                rows: 24,
                data(_term: unknown, data: Uint8Array) {
                    sessionData.sendQ.add(async () => {
                        if (ws.readyState === 1) {
                            ws.send(await pack(cryptoKey, FrameType.DATA, data));
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