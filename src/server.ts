/**
 * ShellPort - Server
 *
 * HTTP + WebSocket server with native PTY allocation (Bun v1.3.5+).
 * Serves the embedded web terminal and manages shell sessions.
 */

import { spawn, spawnSync } from "bun";
import { deriveKey, pack, unpack, getCryptoJS } from "./crypto.js";
import { SeqQueue, FrameType } from "./types.js";
import type { ServerConfig, SessionData } from "./types.js";
import { buildHTML } from "./frontend/build.js";

/** Maximum concurrent PTY sessions */
const MAX_SESSIONS = 10;

/** Seconds to wait for a valid auth frame before disconnecting */
const AUTH_TIMEOUT_S = 10;

/** Environment variables safe to forward to PTY sessions */
const SAFE_ENV_VARS = [
    'HOME', 'USER', 'LOGNAME', 'SHELL', 'PATH',
    'LANG', 'LC_ALL', 'LC_CTYPE', 'XDG_RUNTIME_DIR',
    'TERM', 'COLORTERM',
];

/** Valid values for the --tailscale flag */
const VALID_TAILSCALE_MODES = ['serve', 'funnel'];

function buildSafeEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const key of SAFE_ENV_VARS) {
        if (process.env[key]) env[key] = process.env[key];
    }
    env.TERM = "xterm-256color";
    env.COLORTERM = "truecolor";
    return env;
}

export async function startServer(config: ServerConfig): Promise<void> {
    const cryptoKey = await deriveKey(config.secret);
    const safeEnv = buildSafeEnv();
    let activeSessions = 0;

    console.log(`[ShellPort] Starting PTY WebSocket Server on port ${config.port}...`);

    // Tailscale integration
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

    // Build the HTML client with inlined crypto, terminal emulator, and app logic
    const htmlClient = buildHTML(getCryptoJS());

    Bun.serve({
        port: config.port,

        fetch(req, server) {
            const url = new URL(req.url);

            if (url.pathname === "/ws") {
                // Session cap check
                if (activeSessions >= MAX_SESSIONS) {
                    return new Response("Session limit reached", { status: 503 });
                }

                // Origin validation: reject cross-origin WebSocket upgrades
                const origin = req.headers.get("origin");
                if (origin) {
                    try {
                        const originUrl = new URL(origin);
                        const serverHost = req.headers.get("host")?.split(":")[0] || "localhost";
                        if (originUrl.hostname !== serverHost && originUrl.hostname !== "localhost" && originUrl.hostname !== "127.0.0.1") {
                            return new Response("Origin not allowed", { status: 403 });
                        }
                    } catch {
                        return new Response("Invalid origin", { status: 403 });
                    }
                }

                const data: SessionData = {
                    sendQ: new SeqQueue(),
                    recvQ: new SeqQueue(),
                    proc: null,
                    authenticated: !cryptoKey,
                };
                if (server.upgrade(req, { data: data as unknown as undefined })) {
                    return;
                }
                return new Response("Expected WebSocket", { status: 400 });
            }

            if (url.pathname === "/" || url.pathname === "/index.html") {
                return new Response(htmlClient, {
                    headers: { "Content-Type": "text/html" },
                });
            }

            return new Response("Not found", { status: 404 });
        },

        websocket: {
            open(ws) {
                const sessionData = ws.data as unknown as SessionData;

                // If no encryption, spawn PTY immediately
                if (sessionData.authenticated) {
                    activeSessions++;
                    spawnPTY(ws, sessionData, cryptoKey, safeEnv, () => activeSessions--);
                    return;
                }

                // Require authentication: client must send a valid encrypted
                // frame within AUTH_TIMEOUT_S seconds to prove key knowledge
                sessionData.authTimer = setTimeout(() => {
                    console.log("[ShellPort] Auth timeout — disconnecting.");
                    ws.close(4001, "Authentication timeout");
                }, AUTH_TIMEOUT_S * 1000);
            },

            message(ws, message) {
                const sessionData = ws.data as unknown as SessionData;

                // Authentication gate: first message must decrypt successfully
                if (!sessionData.authenticated) {
                    sessionData.recvQ.add(async () => {
                        const decoded = await unpack(
                            cryptoKey,
                            message as unknown as ArrayBuffer
                        );
                        if (!decoded) {
                            ws.close(4003, "Authentication failed");
                            return;
                        }

                        // Auth passed — clear timeout, spawn PTY
                        if (sessionData.authTimer) clearTimeout(sessionData.authTimer);
                        sessionData.authenticated = true;
                        activeSessions++;
                        spawnPTY(ws, sessionData, cryptoKey, safeEnv, () => activeSessions--);

                        // Process the first message (it's real data/control)
                        handleDecoded(decoded, sessionData);
                    });
                    return;
                }

                // Normal message handling
                sessionData.recvQ.add(async () => {
                    const proc = sessionData.proc;
                    if (!proc || !proc.terminal) return;

                    const decoded = await unpack(
                        cryptoKey,
                        message as unknown as ArrayBuffer
                    );
                    if (!decoded) return;
                    handleDecoded(decoded, sessionData);
                });
            },

            close(ws) {
                const sessionData = ws.data as unknown as SessionData;
                if (sessionData.authTimer) clearTimeout(sessionData.authTimer);
                const proc = sessionData.proc;
                if (proc && !proc.killed) {
                    try {
                        proc.kill();
                    } catch {
                        // Already dead
                    }
                }
                console.log("[ShellPort] PTY session closed.");
            },
        },
    });

    console.log(`[ShellPort] ✅ Listening on http://localhost:${config.port}`);
    console.log(`[ShellPort] 📊 Max sessions: ${MAX_SESSIONS}`);
    if (cryptoKey) {
        console.log(
            `[ShellPort] 🔑 Secure access: http://localhost:${config.port}/#${config.secret}`
        );
    } else {
        console.log(`[ShellPort] ⚠️  No encryption — use --secret for production`);
    }
}

/** Handle a decoded frame (data or control) */
function handleDecoded(decoded: { type: number; payload: Uint8Array }, sessionData: SessionData) {
    if (decoded.type === FrameType.DATA) {
        sessionData.proc?.terminal?.write(decoded.payload);
    } else if (decoded.type === FrameType.CONTROL) {
        try {
            const ctl = JSON.parse(new TextDecoder().decode(decoded.payload));
            if (ctl.type === "resize") {
                sessionData.proc?.terminal?.resize(ctl.cols, ctl.rows);
            }
        } catch {
            // Malformed control message — ignore
        }
    }
}

/** Spawn a PTY process and wire it to the WebSocket */
function spawnPTY(
    ws: any,
    sessionData: SessionData,
    cryptoKey: CryptoKey | null,
    env: Record<string, string>,
    onClose: () => void,
) {
    console.log("[ShellPort] New PTY session allocated.");
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
    } catch (error) {
        console.error("[ShellPort] PTY spawn failed:", error);
        onClose();
        ws.close(1011, "PTY Spawn Failed");
    }
}
