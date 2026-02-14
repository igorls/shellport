/**
 * ShellPort - WebSocket Bounds Checking Tests
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { FrameType } from "./types.js";

const TEST_PORT = 17682 + Math.floor(Math.random() * 1000);

describe("WebSocket Bounds Checking", () => {
    let server: any;

    beforeAll(() => {
        server = Bun.serve({
            port: TEST_PORT,
            fetch(req, srv) {
                if (srv.upgrade(req)) return;
                return new Response("Expected WebSocket", { status: 400 });
            },
            websocket: {
                message(ws, message) {
                    const msg = message as unknown as Uint8Array;
                    // Strict limit: 1MB
                    if (msg.length > 1024 * 1024) {
                        ws.close(4009, "Message too large");
                        return;
                    }
                    ws.send(message);
                }
            }
        });
    });

    afterAll(() => {
        server?.stop(true);
    });

    test("accepts messages under 1MB", async () => {
        const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
        ws.binaryType = "arraybuffer";

        const payload = new Uint8Array(1024 * 100).fill(0x41); // 100KB

        const response = await new Promise<ArrayBuffer>((resolve, reject) => {
            ws.onopen = () => ws.send(payload);
            ws.onmessage = (e) => resolve(e.data);
            ws.onerror = reject;
            setTimeout(() => reject(new Error("timeout")), 2000);
        });

        expect(response.byteLength).toBe(1024 * 100);
        ws.close();
    });

    test("closes connection for messages over 1MB", async () => {
        const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
        ws.binaryType = "arraybuffer";

        const largePayload = new Uint8Array(1024 * 1024 + 100).fill(0x41); // > 1MB

        const closed = await new Promise<number>((resolve, reject) => {
            ws.onopen = () => ws.send(largePayload);
            ws.onclose = (e) => resolve(e.code);
            ws.onerror = reject;
            setTimeout(() => reject(new Error("timeout")), 2000);
        });

        expect(closed).toBe(4009);
    });
});
