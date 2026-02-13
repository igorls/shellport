/**
 * ShellPort - CLI Client
 *
 * Connects to a ShellPort server via WebSocket from the terminal.
 * Supports raw mode, terminal resize forwarding, and E2E encryption.
 *
 * Protocol v2 handshake:
 * 1. Server sends server_nonce (16 bytes)
 * 2. Client sends client_nonce (16 bytes)
 * 3. Both derive per-session salt from SHA-256(server_nonce || client_nonce || "shellport-v2")
 * 4. Key derived using PBKDF2(secret, session_salt)
 * 5. Encrypted communication begins
 */

import { deriveKey, pack, unpack, generateNonce, deriveSessionSalt } from "./crypto.js";
import { SeqQueue, FrameType } from "./types.js";
import type { ClientConfig, FrameTypeValue } from "./types.js";

const NONCE_LENGTH = 16;

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

    ws.addEventListener("open", () => {
        console.log("[ShellPort] Connected, negotiating...");
        
        if (!config.secret) {
            clientNonce = generateNonce();
            sendMsg(FrameType.CLIENT_NONCE, clientNonce);
            console.log("[ShellPort] Plaintext mode (no encryption)");
            authenticated = true;
            
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
        }
    });

    ws.addEventListener("message", async (event) => {
        const data = event.data as ArrayBuffer;
        const msgView = new Uint8Array(data);

        if (!cryptoKey && config.secret && !serverNonce) {
            if (msgView.length >= NONCE_LENGTH) {
                serverNonce = msgView.slice(0, NONCE_LENGTH);
                clientNonce = generateNonce();
                
                sendMsg(FrameType.CLIENT_NONCE, clientNonce);
                
                const sessionSalt = await deriveSessionSalt(serverNonce, clientNonce);
                cryptoKey = await deriveKey(config.secret, sessionSalt);
                
                authenticated = true;
                console.log("[ShellPort] 🔒 Session established with per-session key");
                
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
            }
            return;
        }

        if (!authenticated || !cryptoKey) {
            return;
        }

        recvQ.add(async () => {
            const decoded = await unpack(cryptoKey!, data);
            if (!decoded) {
                console.error("\n[ShellPort] Security error: decryption failed.");
                ws.close();
                process.exit(1);
            }
            if (decoded.type === FrameType.DATA) {
                process.stdout.write(decoded.payload);
            }
        });
    });

    process.stdin.on("data", (chunk) => {
        if (!authenticated) return;
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

    ws.addEventListener("close", cleanup);
    ws.addEventListener("error", cleanup);

    process.on("SIGINT", () => { });
    process.on("exit", () => isTTY && process.stdin.setRawMode(false));
}