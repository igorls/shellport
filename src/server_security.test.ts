import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { startServer, MAX_MESSAGE_SIZE } from "./server.js";
import { PROTOCOL_VERSION } from "./crypto.js";

const TEST_PORT = 17682 + Math.floor(Math.random() * 1000);
let server: any = null;

beforeAll(async () => {
    // Start the actual application server
    // Using a TOTP secret configuration prevents the immediate PTY spawn on connect
    // in plaintext mode, allowing the websocket to stay open and wait for messages.
    server = await startServer({
        port: TEST_PORT,
        secret: "",
        tailscale: "",
        requireApproval: false,
        allowLocalhost: true,
        totp: true,
        totpSecret: "JBSWY3DPEHPK3PXP", // dummy secret
    });
});

afterAll(() => {
    if (server) {
        server.stop(true);
    }
});

describe("Security Limits", () => {
    test("rejects WebSocket messages larger than MAX_MESSAGE_SIZE to prevent DoS", async () => {
        const ws = new WebSocket(`ws://localhost:${TEST_PORT}/ws`, [`shellport-v${PROTOCOL_VERSION}`]);
        ws.binaryType = "arraybuffer";

        // Wait for the connection to open
        await new Promise<void>((resolve, reject) => {
            ws.addEventListener("open", () => resolve());
            ws.addEventListener("error", reject);
        });

        const largePayload = new Uint8Array(MAX_MESSAGE_SIZE + 1);

        const closed = new Promise<number>((resolve, reject) => {
            ws.addEventListener("close", (e) => resolve(e.code));
            setTimeout(() => reject(new Error("timeout")), 3000);
        });

        ws.send(largePayload);

        const closeCode = await closed;
        // The server should intercept and close with 1009
        expect(closeCode).toBe(1009); // Message Too Big
    });

    test("accepts valid messages smaller than MAX_MESSAGE_SIZE", async () => {
        const ws = new WebSocket(`ws://localhost:${TEST_PORT}/ws`, [`shellport-v${PROTOCOL_VERSION}`]);
        ws.binaryType = "arraybuffer";

        // Wait for the connection to open
        await new Promise<void>((resolve, reject) => {
            ws.addEventListener("open", () => resolve());
            ws.addEventListener("error", reject);
        });

        const testPayload = new Uint8Array([0, 1, 2, 3]); // Small frame payload

        const openAndNotClosed = new Promise<boolean>((resolve, reject) => {
            ws.addEventListener("close", () => resolve(false));
            // If it doesn't close within a reasonable time after sending a message, it was accepted
            setTimeout(() => resolve(true), 100);
        });

        ws.send(testPayload);

        const remainedOpen = await openAndNotClosed;
        expect(remainedOpen).toBe(true);
        ws.close();
    });
});
