import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { startServer, MAX_MESSAGE_SIZE, MAX_TRACKED_IPS, rateLimitMap } from "./server.js";
import { PROTOCOL_VERSION } from "./crypto.js";

describe("Security Limits", () => {
    let server: any;
    const PORT = 7682; // Different port to avoid conflicts
    const WS_URL = `ws://localhost:${PORT}/ws`;

    beforeEach(async () => {
        rateLimitMap.clear();
        server = await startServer({
            port: PORT,
            secret: "",
            totp: true,
            totpSecret: "DUMMYSECRET",
            requireApproval: false,
            allowLocalhost: true,
            tailscale: "",
        });
    });

    afterEach(() => {
        if (server) {
            if (server._cleanupTimer) {
                clearInterval(server._cleanupTimer);
            }
            server.stop(true);
        }
        rateLimitMap.clear();
    });

    it("WebSocket > enforces MAX_MESSAGE_SIZE", async () => {
        // Connect to the server
        const ws = new WebSocket(WS_URL, `shellport-v${PROTOCOL_VERSION}`);

        // Wait for open
        await new Promise<void>((resolve, reject) => {
            ws.onopen = () => resolve();
            ws.onerror = (err) => reject(err);
        });

        // The initial frame (TOTP challenge)
        await new Promise<void>((resolve) => {
            ws.onmessage = () => resolve();
        });

        // Test sending a valid message (below limit)
        const validPayload = new Uint8Array(MAX_MESSAGE_SIZE - 1024);
        ws.send(validPayload);

        // We should still be connected
        expect(ws.readyState).toBe(WebSocket.OPEN);

        // Test sending an oversized message
        let closedPromise = new Promise<void>((resolve, reject) => {
            ws.onclose = (event) => {
                try {
                    expect(event.code === 1009 || event.code === 1006).toBe(true); // Server might forcefully close it without 1009 to client
                    resolve();
                } catch (e) {
                    reject(e);
                }
            };
            setTimeout(() => reject(new Error("Timeout waiting for onclose")), 2000);
        });

        const oversizePayload = new Uint8Array(MAX_MESSAGE_SIZE + 1024);
        ws.send(oversizePayload);

        await closedPromise;
    });

    it("Rate Limiter > enforces MAX_TRACKED_IPS limit", async () => {
        // Fill the rate limit map with fake IPs up to MAX_TRACKED_IPS
        for (let i = 0; i < MAX_TRACKED_IPS; i++) {
            rateLimitMap.set(`10.0.0.${i}`, [Date.now()]);
        }

        // Let's just verify the Map size directly and test via an isolated test function if needed
        expect(rateLimitMap.size).toBe(MAX_TRACKED_IPS);

        const ws2 = new WebSocket(WS_URL, `shellport-v${PROTOCOL_VERSION}`);

        let ws2Promise = new Promise<void>((resolve, reject) => {
            ws2.onopen = () => { ws2.close(); resolve(); };
            ws2.onerror = (e) => reject(e);
            // It could close immediately due to 429
            ws2.onclose = () => resolve();
            setTimeout(() => resolve(), 2000);
        });
        await ws2Promise;
        expect(rateLimitMap.size).toBe(MAX_TRACKED_IPS);
    });
});
