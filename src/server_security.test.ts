import { describe, test, expect, mock, spyOn } from "bun:test";
import { startServer, MAX_MESSAGE_SIZE } from "./server.js";
import { FrameType } from "./types.js";

// Mock Bun.serve and spawn
// We can't easily mock "bun" module directly in the same process if other tests rely on it,
// but we can try to intercept the call or just run this test file in isolation.
// Actually, Bun.serve is a global, but imported as part of "bun".
// startServer calls Bun.serve()

describe("Server Security", () => {
    test("Rejects messages larger than MAX_MESSAGE_SIZE", async () => {
        // We need to capture the websocket handler passed to Bun.serve
        let wsHandler: any = null;

        // Mock Bun.serve
        const originalServe = Bun.serve;
        const serveSpy = spyOn(Bun, "serve").mockImplementation((options: any) => {
            wsHandler = options.websocket;
            return {
                stop: () => {},
                port: options.port,
                hostname: "localhost",
                pendingRequests: 0,
                pendingWebSockets: 0,
                development: false,
                fetch: options.fetch,
                upgrade: () => true,
                requestIP: () => ({ address: "127.0.0.1" }),
            } as any;
        });

        // Start server with minimal config
        await startServer({
            port: 0, // Random port
            secret: "test-secret",
            requireApproval: false,
            allowLocalhost: true,
            totp: false,
            tailscale: "",
        });

        expect(wsHandler).toBeTruthy();
        expect(wsHandler.message).toBeDefined();

        // Create a mock WebSocket
        const mockWs = {
            data: {
                clientIP: "127.0.0.1",
                authenticated: true, // Bypass handshake for this test
                recvQ: { add: (fn: any) => fn() }, // Immediate execution
            },
            close: mock(),
            send: mock(),
        };

        // Create a large message
        const largeMessage = new Uint8Array(MAX_MESSAGE_SIZE + 1);

        // Call the message handler
        await wsHandler.message(mockWs, largeMessage);

        // Assert
        expect(mockWs.close).toHaveBeenCalledWith(1009, "Message too big");

        // Cleanup
        serveSpy.mockRestore();
    });

    test("Accepts messages within MAX_MESSAGE_SIZE", async () => {
        let wsHandler: any = null;
        const serveSpy = spyOn(Bun, "serve").mockImplementation((options: any) => {
            wsHandler = options.websocket;
            return { stop: () => {} } as any;
        });

        await startServer({
            port: 0,
            secret: "",
            totp: false,
            tailscale: "",
            requireApproval: false,
            allowLocalhost: true
        });

        const mockWs = {
            data: {
                clientIP: "127.0.0.1",
                authenticated: true,
                recvQ: { add: (fn: any) => fn() },
                sendQ: { add: (fn: any) => fn() },
            },
            close: mock(),
            send: mock(),
            readyState: 1,
        };

        const smallMessage = new Uint8Array(MAX_MESSAGE_SIZE); // Exact limit

        // Call handler
        // We expect it to try to process it (unpack/etc), not close immediately with 1009
        // It might close with 4003 (Auth failed) or something else if unpack fails, but NOT 1009
        await wsHandler.message(mockWs, smallMessage);

        // Check calls to close
        // If it called close, it should NOT be 1009
        const closeCalls = (mockWs.close as any).mock.calls;
        const closedWith1009 = closeCalls.some((args: any[]) => args[0] === 1009);
        expect(closedWith1009).toBe(false);

        serveSpy.mockRestore();
    });
});
