import { describe, test, expect, afterEach } from "bun:test";
import { rateLimitMap, cleanupRateLimits, RATE_LIMIT_WINDOW_MS } from "./server.js";

describe("Rate Limiter Cleanup", () => {
    afterEach(() => {
        rateLimitMap.clear();
    });

    test("cleanupRateLimits removes stale entries", () => {
        const now = Date.now();
        const oldTime = now - RATE_LIMIT_WINDOW_MS - 1000; // 1 second older than window
        const newTime = now;

        // Add stale entry
        rateLimitMap.set("1.1.1.1", [oldTime]);

        // Add active entry
        rateLimitMap.set("2.2.2.2", [newTime]);

        // Add entry with multiple timestamps, all old
        rateLimitMap.set("3.3.3.3", [oldTime, oldTime + 100]);

        // Add entry with mixed timestamps (some old, some new)
        // The newest is new, so it should stay.
        rateLimitMap.set("4.4.4.4", [oldTime, newTime]);

        expect(rateLimitMap.size).toBe(4);

        cleanupRateLimits();

        expect(rateLimitMap.has("1.1.1.1")).toBe(false); // Stale
        expect(rateLimitMap.has("2.2.2.2")).toBe(true);  // Active
        expect(rateLimitMap.has("3.3.3.3")).toBe(false); // Stale
        expect(rateLimitMap.has("4.4.4.4")).toBe(true);  // Active
    });

    test("cleanupRateLimits handles empty entries", () => {
        rateLimitMap.set("empty", []);
        cleanupRateLimits();
        expect(rateLimitMap.has("empty")).toBe(false);
    });
});
