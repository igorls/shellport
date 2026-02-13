/**
 * ShellPort - CLI Client
 *
 * Connects to a ShellPort server via WebSocket from the terminal.
 * Supports raw mode, terminal resize forwarding, and E2E encryption.
 */

import { deriveKey, pack, unpack } from "./crypto.js";
import { SeqQueue, FrameType } from "./types.js";
import type { ClientConfig, FrameTypeValue } from "./types.js";

export async function connectClient(config: ClientConfig): Promise<void> {
    if (!config.url) {
        console.error("Usage: shellport client <ws-url> [--secret key]");
        process.exit(1);
    }

    const cryptoKey = await deriveKey(config.secret);
    const ws = new WebSocket(config.url);
    ws.binaryType = "arraybuffer";

    const isTTY = process.stdout.isTTY;
    const sendQ = new SeqQueue();
    const recvQ = new SeqQueue();

    const sendMsg = (type: FrameTypeValue, payload: Uint8Array) =>
        sendQ.add(async () => {
            if (ws.readyState === 1) ws.send(await pack(cryptoKey, type, payload));
        });

    ws.addEventListener("open", () => {
        console.log("[ShellPort] Connected!");
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

        process.stdin.on("data", (chunk) =>
            sendMsg(
                FrameType.DATA,
                typeof chunk === "string"
                    ? new TextEncoder().encode(chunk)
                    : new Uint8Array(chunk as Buffer)
            )
        );
    });

    ws.addEventListener("message", (event) =>
        recvQ.add(async () => {
            const decoded = await unpack(cryptoKey, event.data as ArrayBuffer);
            if (!decoded) {
                console.error("\n[ShellPort] Security error: decryption failed.");
                process.exit(1);
            }
            if (decoded.type === FrameType.DATA) {
                process.stdout.write(decoded.payload);
            }
        })
    );

    const cleanup = () => {
        if (isTTY) process.stdin.setRawMode(false);
        console.log("\n[ShellPort] Closed.");
        process.exit(0);
    };

    ws.addEventListener("close", cleanup);
    ws.addEventListener("error", cleanup);

    // Prevent Ctrl+C from killing the process — pass it to the remote shell
    process.on("SIGINT", () => { });
    process.on("exit", () => isTTY && process.stdin.setRawMode(false));
}
