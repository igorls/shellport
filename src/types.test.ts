/**
 * ShellPort - Types & SeqQueue Tests
 *
 * Tests FrameType constants and SeqQueue ordering guarantees.
 */

import { describe, test, expect } from "bun:test";
import { SeqQueue, FrameType } from "./types.js";

// ---------------------------------------------------------------------------
// FrameType constants
// ---------------------------------------------------------------------------
describe("FrameType", () => {
    test("DATA = 0, CONTROL = 1", () => {
        expect(FrameType.DATA).toBe(0);
        expect(FrameType.CONTROL).toBe(1);
    });

    test("only has DATA and CONTROL keys", () => {
        const keys = Object.keys(FrameType);
        expect(keys).toEqual(["DATA", "CONTROL"]);
    });
});

// ---------------------------------------------------------------------------
// SeqQueue
// ---------------------------------------------------------------------------
describe("SeqQueue", () => {
    test("executes tasks in FIFO order", async () => {
        const q = new SeqQueue();
        const results: number[] = [];

        q.add(async () => { results.push(1); });
        q.add(async () => { results.push(2); });
        q.add(async () => { results.push(3); });

        // Wait for all tasks to drain
        await new Promise(resolve => setTimeout(resolve, 50));

        expect(results).toEqual([1, 2, 3]);
    });

    test("maintains order with varying async delays", async () => {
        const q = new SeqQueue();
        const results: string[] = [];

        q.add(async () => {
            await new Promise(r => setTimeout(r, 30));
            results.push("slow");
        });
        q.add(async () => {
            results.push("fast");
        });
        q.add(async () => {
            await new Promise(r => setTimeout(r, 10));
            results.push("medium");
        });

        await new Promise(resolve => setTimeout(resolve, 150));

        expect(results).toEqual(["slow", "fast", "medium"]);
    });

    test("continues execution after a failing task", async () => {
        const q = new SeqQueue();
        const results: string[] = [];

        // Suppress console.error for this test
        const origError = console.error;
        console.error = () => { };

        q.add(async () => { results.push("before"); });
        q.add(async () => { throw new Error("boom"); });
        q.add(async () => { results.push("after"); });

        await new Promise(resolve => setTimeout(resolve, 50));
        console.error = origError;

        expect(results).toEqual(["before", "after"]);
    });

    test("handles many queued tasks", async () => {
        const q = new SeqQueue();
        const results: number[] = [];
        const N = 100;

        for (let i = 0; i < N; i++) {
            q.add(async () => { results.push(i); });
        }

        await new Promise(resolve => setTimeout(resolve, 200));

        expect(results.length).toBe(N);
        expect(results).toEqual(Array.from({ length: N }, (_, i) => i));
    });
});
