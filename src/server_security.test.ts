import { describe, test, expect, afterAll, beforeAll } from "bun:test";
import { startServer, MAX_MESSAGE_SIZE } from "./server.js";
import { PROTOCOL_VERSION } from "./crypto.js";
import { ServerConfig } from "./types.js";

const TEST_PORT = 18681 + Math.floor(Math.random() * 1000);

describe("Server Security Limits", () => {
    let server: import("bun").Server<any>;

    beforeAll(async () => {
        const config: ServerConfig = {
            port: TEST_PORT,
            secret: "test-secret",
            tailscale: "",
            requireApproval: false,
            allowLocalhost: true,
            totp: false,
        };
        server = await startServer(config);
    });

    afterAll(() => {
        server.stop(true);
    });

    test("should reject messages larger than limit", async () => {
        // Must specify protocol version to pass handshake
        const ws = new WebSocket(`ws://localhost:${TEST_PORT}/ws`, [`shellport-v${PROTOCOL_VERSION}`]);

        await new Promise<void>((resolve, reject) => {
            ws.addEventListener("open", () => resolve());
            ws.addEventListener("error", reject);
        });

        // Create a message larger than MAX_MESSAGE_SIZE
        const hugePayload = new Uint8Array(MAX_MESSAGE_SIZE + 1024);
        ws.send(hugePayload);

        const closeEvent = await new Promise<CloseEvent>((resolve) => {
             ws.addEventListener("close", (e) => resolve(e));
             setTimeout(() => resolve(new CloseEvent("close", { code: 0, reason: "timeout" })), 2000);
        });

        expect(closeEvent.code).toBe(1009);
        expect(closeEvent.reason).toBe("Message too big");
    });
});
