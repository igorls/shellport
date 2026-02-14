/**
 * ShellPort - CLI Client
 *
 * Connects to a ShellPort server via WebSocket from the terminal.
 * Supports raw mode, terminal resize forwarding, E2E encryption,
 * and TOTP 2FA authentication.
 *
 * Protocol v2 handshake:
 * 1. Server sends server_nonce (16 bytes)
 * 2. Client sends client_nonce (16 bytes)
 * 3. Both derive per-session salt from SHA-256(server_nonce || client_nonce || "shellport-v2")
 * 4. Key derived using PBKDF2(secret, session_salt)
 * 5. If TOTP enabled: server sends TOTP_CHALLENGE, client responds with TOTP_RESPONSE
 * 6. Encrypted communication begins
 */

import { deriveKey, pack, unpack, generateNonce, deriveSessionSalt } from "./crypto.js";
import { SeqQueue, FrameType } from "./types.js";
import type { ClientConfig, FrameTypeValue } from "./types.js";

const NONCE_LENGTH = 16;

/**
 * Prompt user for TOTP code in the terminal.
 */
function promptTOTP(): Promise<string> {
    return new Promise((resolve) => {
        process.stdout.write("\n\x1b[93m🔐 Enter TOTP code: \x1b[0m");

        // Temporarily exit raw mode if it was set
        const wasRaw = process.stdin.isRaw;
        if (wasRaw) process.stdin.setRawMode(false);

        let input = "";
        const onData = (data: Buffer) => {
            const char = data.toString();

            // Handle Enter
            if (char === "\n" || char === "\r") {
                process.stdin.removeListener("data", onData);
                process.stdout.write("\n");
                if (wasRaw) process.stdin.setRawMode(true);
                resolve(input.trim());
                return;
            }

            // Handle backspace
            if (char === "\x7f" || char === "\x08") {
                if (input.length > 0) {
                    input = input.slice(0, -1);
                    process.stdout.write("\b \b");
                }
                return;
            }

            // Only accept digits
            if (/^\d$/.test(char)) {
                input += char;
                process.stdout.write(char);

                // Auto-submit on 6 digits
                if (input.length === 6) {
                    process.stdin.removeListener("data", onData);
                    process.stdout.write("\n");
                    if (wasRaw) process.stdin.setRawMode(true);
                    resolve(input);
                }
            }
        };

        process.stdin.on("data", onData);
    });
}

export async function connectClient(config: ClientConfig): Promise<void> {
    if (!config.url) {
        console.error("Usage: shellport client <ws-url> [--secret key]");
        process.exit(1);
    }

    const ws = new WebSocket(config.url);
    ws.binaryType = "arraybuffer";

    const isTTY = process.stdout.isTTY;
    const sendQ = new SeqQueue();
    const recvQ = new SeqQueue();

    let cryptoKey: CryptoKey | null = null;
    let serverNonce: Uint8Array | null = null;
    let clientNonce: Uint8Array | null = null;
    let authenticated = false;
    let totpPending = false;
    let sessionReady = false;

    const sendMsg = (type: FrameTypeValue, payload: Uint8Array) =>
        sendQ.add(async () => {
            if (ws.readyState === 1) {
                if (type === FrameType.CLIENT_NONCE || !cryptoKey) {
                    ws.send(await pack(null, type, payload));
                } else {
                    ws.send(await pack(cryptoKey, type, payload));
                }
            }
        });

    /** Enter interactive terminal mode */
    const startTerminal = () => {
        if (sessionReady) return;
        sessionReady = true;

        if (isTTY) {
            process.stdin.setRawMode(true);
            const sendSize = () => {
                sendMsg(
                    FrameType.CONTROL,
                    new TextEncoder().encode(
                        JSON.stringify({
                            type: "resize",
                            cols: process.stdout.columns,
                            rows: process.stdout.rows,
                        })
                    )
                );
            };
            sendSize();
            process.stdout.on("resize", sendSize);
        }
    };

    ws.addEventListener("open", () => {
        console.log("[ShellPort] Connected, negotiating...");

        if (!config.secret) {
            clientNonce = generateNonce();
            sendMsg(FrameType.CLIENT_NONCE, clientNonce);
            console.log("[ShellPort] Plaintext mode (no encryption)");
            authenticated = true;
            // Don't start terminal yet — might get TOTP challenge
        }
    });

    ws.addEventListener("message", async (event) => {
        const data = event.data as ArrayBuffer;
        const msgView = new Uint8Array(data);

        // ─── Step 1: Nonce exchange (encrypted mode) ───
        if (!cryptoKey && config.secret && !serverNonce) {
            if (msgView.length >= NONCE_LENGTH) {
                serverNonce = msgView.slice(0, NONCE_LENGTH);
                clientNonce = generateNonce();

                sendMsg(FrameType.CLIENT_NONCE, clientNonce);

                const sessionSalt = await deriveSessionSalt(serverNonce, clientNonce);
                cryptoKey = await deriveKey(config.secret, sessionSalt);

                authenticated = true;
                console.log("[ShellPort] 🔒 Session established with per-session key");
                // Don't start terminal yet — might get TOTP challenge
            }
            return;
        }

        // ─── Step 2: Check for TOTP challenge ───
        if (authenticated && !sessionReady) {
            const decoded = await unpack(cryptoKey, data);
            if (decoded && decoded.type === FrameType.TOTP_CHALLENGE) {
                totpPending = true;
                console.log("[ShellPort] 🔐 TOTP verification required");

                const code = await promptTOTP();
                sendMsg(FrameType.TOTP_RESPONSE, new TextEncoder().encode(code));
                return;
            }

            // If it's data and not a TOTP challenge, session is ready
            startTerminal();
            if (decoded && decoded.type === FrameType.DATA) {
                process.stdout.write(decoded.payload);
            }
            return;
        }

        // ─── Step 3: Normal data flow ───
        if (!sessionReady) return;

        recvQ.add(async () => {
            const decoded = await unpack(cryptoKey, data);
            if (!decoded) {
                if (cryptoKey) {
                    console.error("\n[ShellPort] Security error: decryption failed.");
                    ws.close();
                    process.exit(1);
                }
                return;
            }

            if (decoded.type === FrameType.DATA) {
                // First data after TOTP means we're verified
                if (totpPending) {
                    totpPending = false;
                    console.log("[ShellPort] ✅ TOTP verified");
                    startTerminal();
                }
                process.stdout.write(decoded.payload);
            }
        });
    });

    process.stdin.on("data", (chunk) => {
        if (!sessionReady) return;
        sendMsg(
            FrameType.DATA,
            typeof chunk === "string"
                ? new TextEncoder().encode(chunk)
                : new Uint8Array(chunk as Buffer)
        );
    });

    const cleanup = () => {
        if (isTTY) process.stdin.setRawMode(false);
        console.log("\n[ShellPort] Closed.");
        process.exit(0);
    };

    ws.addEventListener("close", (e) => {
        if (e.code === 4003 && totpPending) {
            console.error("\n[ShellPort] ❌ Invalid TOTP code. Connection closed.");
        }
        cleanup();
    });
    ws.addEventListener("error", cleanup);

    process.on("SIGINT", () => { });
    process.on("exit", () => isTTY && process.stdin.setRawMode(false));
}