import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { startServer, MAX_MESSAGE_SIZE } from "./server.js";
import { generateSecret, pack } from "./crypto.js";
import { FrameType } from "./types.js";

const TEST_PORT = 17682 + Math.floor(Math.random() * 1000);
const SECRET = generateSecret();

beforeAll(async () => {
    // Start the actual server implementation
    // Disable TOTP so we can immediately enter the normal message handler logic
    const startPromise = startServer({
        port: TEST_PORT,
        secret: SECRET,
        tailscale: "",
        requireApproval: false,
        allowLocalhost: true,
        totp: false,
        totpSecret: undefined,
    });

    // In startServer, Bun.serve doesn't return the instance directly, but startServer
    // itself is a promise that resolves when it's listening.
    // To stop it cleanly we'll let bun close it on process exit or we can skip stopping it
    // if the framework allows it since it's an isolated process.
    // But since startServer returns void and doesn't export the server instance directly,
    // we can just rely on process exit.
    await startPromise;
});

afterAll(() => {
    // Rely on process exit for cleanup since startServer doesn't expose the instance directly.
});

describe("Security: WebSocket Message Size", () => {
    test("rejects messages larger than MAX_MESSAGE_SIZE", async () => {
        const ws = new WebSocket(`ws://localhost:${TEST_PORT}/ws`, "shellport-v2");

        await new Promise<void>((resolve) => {
            ws.addEventListener("open", () => resolve());
        });

        const largePayload = new Uint8Array(MAX_MESSAGE_SIZE + 10);

        const closeCode = await new Promise<number>((resolve) => {
            ws.addEventListener("close", (e) => resolve(e.code));
            ws.send(largePayload);
        });

        // Bun closes with 1009 natively when maxPayloadLength is exceeded
        expect([1009, 1006]).toContain(closeCode);
    });

    test("accepts messages within MAX_MESSAGE_SIZE", async () => {
        const ws = new WebSocket(`ws://localhost:${TEST_PORT}/ws`, "shellport-v2");

        await new Promise<void>((resolve) => {
            ws.addEventListener("open", () => resolve());
        });

        // Initial nonce message
        await new Promise<void>((resolve) => {
            ws.addEventListener("message", () => resolve(), { once: true });
        });

        // Send client nonce to authenticate
        const clientNonce = new Uint8Array(16);
        const authPayload = new Uint8Array(17);
        authPayload[0] = FrameType.CLIENT_NONCE;
        authPayload.set(clientNonce, 1);
        ws.send(authPayload);

        // Send a valid packet
        const payload = new TextEncoder().encode("Hello");
        const packed = await pack(null, FrameType.DATA, payload);

        // Wait briefly to ensure it wasn't closed
        let closed = false;
        ws.addEventListener("close", () => { closed = true; });

        ws.send(packed);

        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(closed).toBe(false);
        ws.close();
    });
});
