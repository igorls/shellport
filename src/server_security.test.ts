import { describe, test, expect, afterEach } from "bun:test";
import { startServer, MAX_MESSAGE_SIZE, MAX_TRACKED_IPS, rateLimitMap, checkRateLimit } from "./server.js";
import { PROTOCOL_VERSION } from "./crypto.js";

const TEST_PORT = 17682; // Different port to avoid conflict

describe("Security Limits", () => {
    let server: ReturnType<typeof Bun.serve> | null = null;

    afterEach(() => {
        if (server) {
            server.stop(true);
            server = null;
        }
        rateLimitMap.clear();
    });

    test("MAX_MESSAGE_SIZE: rejects large messages", async () => {
        // Start server with minimal config
        server = await startServer({
            port: TEST_PORT,
            secret: "test-secret",
            tailscale: "",
            requireApproval: false,
            allowLocalhost: true,
            totp: false
        });

        const ws = new WebSocket(`ws://localhost:${TEST_PORT}/ws`, `shellport-v${PROTOCOL_VERSION}`);

        // Wait for open
        await new Promise<void>((resolve, reject) => {
            ws.addEventListener("open", () => resolve());
            ws.addEventListener("error", (e) => reject(e));
            ws.addEventListener("close", (e) => reject(new Error(`WS Closed before open: ${e.code} ${e.reason}`)));
            setTimeout(() => reject(new Error("Timeout waiting for open")), 5000);
        });

        // Create a large message (MAX_MESSAGE_SIZE + 1)
        const hugePayload = new Uint8Array(MAX_MESSAGE_SIZE + 1);

        // Send it
        ws.send(hugePayload);

        // Expect close event with code 1009
        const closeEvent = await new Promise<CloseEvent>((resolve, reject) => {
             ws.addEventListener("close", (e) => resolve(e));
             setTimeout(() => reject(new Error("Timeout waiting for close")), 5000);
        });

        expect(closeEvent.code).toBe(1009);
        expect(closeEvent.reason).toBe("Message too big");
    });

    test("MAX_MESSAGE_SIZE: rejects large string messages", async () => {
        // Start server with minimal config
        server = await startServer({
            port: TEST_PORT,
            secret: "test-secret",
            tailscale: "",
            requireApproval: false,
            allowLocalhost: true,
            totp: false
        });

        const ws = new WebSocket(`ws://localhost:${TEST_PORT}/ws`, `shellport-v${PROTOCOL_VERSION}`);

        // Wait for open
        await new Promise<void>((resolve, reject) => {
            ws.addEventListener("open", () => resolve());
            ws.addEventListener("error", (e) => reject(e));
            ws.addEventListener("close", (e) => reject(new Error(`WS Closed before open: ${e.code} ${e.reason}`)));
            setTimeout(() => reject(new Error("Timeout waiting for open")), 5000);
        });

        // Create a large string (MAX_MESSAGE_SIZE + 1)
        const hugeString = "A".repeat(MAX_MESSAGE_SIZE + 1);

        // Send it
        ws.send(hugeString);

        // Expect close event with code 1009
        const closeEvent = await new Promise<CloseEvent>((resolve, reject) => {
             ws.addEventListener("close", (e) => resolve(e));
             setTimeout(() => reject(new Error("Timeout waiting for close")), 5000);
        });

        expect(closeEvent.code).toBe(1009);
        expect(closeEvent.reason).toBe("Message too big");
    });

    test("MAX_TRACKED_IPS: rejects new IPs when map is full", () => {
        // Fill the map
        for (let i = 0; i < MAX_TRACKED_IPS; i++) {
            rateLimitMap.set(`10.0.0.${i}`, [Date.now()]);
        }

        expect(rateLimitMap.size).toBe(MAX_TRACKED_IPS);

        // Try to add a new IP
        const allowed = checkRateLimit("192.168.1.1");
        expect(allowed).toBe(false);

        // Try to access an existing IP (should still be allowed)
        const allowedExisting = checkRateLimit("10.0.0.0");
        expect(allowedExisting).toBe(true);
    });
});
