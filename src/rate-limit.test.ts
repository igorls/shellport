import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { RateLimiter, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from "./rate-limit.js";

describe("RateLimiter", () => {
    let limiter: RateLimiter;
    let originalNow: () => number;
    let mockTime: number;

    beforeEach(() => {
        limiter = new RateLimiter();
        originalNow = Date.now;
        mockTime = 1000000; // Start at arbitrary time
        Date.now = () => mockTime;
    });

    afterEach(() => {
        Date.now = originalNow;
        limiter.stopCleanupInterval();
    });

    test("allows requests within limit", () => {
        const ip = "192.168.1.1";
        for (let i = 0; i < RATE_LIMIT_MAX; i++) {
            expect(limiter.check(ip)).toBe(true);
        }
    });

    test("blocks requests exceeding limit", () => {
        const ip = "192.168.1.2";
        for (let i = 0; i < RATE_LIMIT_MAX; i++) {
            limiter.check(ip);
        }
        expect(limiter.check(ip)).toBe(false);
    });

    test("allows requests after window passes", () => {
        const ip = "192.168.1.3";
        // Fill up the limit
        for (let i = 0; i < RATE_LIMIT_MAX; i++) {
            limiter.check(ip);
        }
        expect(limiter.check(ip)).toBe(false);

        // Advance time past the window
        mockTime += RATE_LIMIT_WINDOW_MS + 1000;

        // Should allow again (and prune old timestamps)
        expect(limiter.check(ip)).toBe(true);
    });

    test("cleanup removes expired entries", () => {
        const ip1 = "10.0.0.1";
        const ip2 = "10.0.0.2";

        // Add entries
        limiter.check(ip1);
        limiter.check(ip2);

        expect(limiter.size).toBe(2);

        // Let's age everything out
        mockTime += RATE_LIMIT_WINDOW_MS + 1000;

        // Verify size is still 2 (cleanup hasn't run yet)
        expect(limiter.size).toBe(2);

        // Run cleanup
        limiter.cleanup();

        // Should be empty now
        expect(limiter.size).toBe(0);
    });

    test("cleanup removes partially expired entries correctly", () => {
        const ip = "192.168.1.5";

        // t=0 (relative to mock start)
        limiter.check(ip); // timestamp: 1000000

        // t=30000
        mockTime += 30000;
        limiter.check(ip); // timestamp: 1000000, 1030000

        // t=61000 (window starts at 1000)
        mockTime = 1000000 + 61000;

        // Before cleanup, map has both
        // Run cleanup
        limiter.cleanup();

        // 1000000 should be removed (expired)
        // 1030000 should be kept (valid)
        // IP should still exist
        expect(limiter.size).toBe(1);

        // Verify via check behavior: we should have 1 count effectively?
        // check() calculates count based on valid timestamps.
        // If we add 4 more, we should hit limit (1 existing + 4 new = 5)

        for(let i=0; i<3; i++) limiter.check(ip);
        // Total 4 now? (1 valid old + 3 new) => allows 5th?
        expect(limiter.check(ip)).toBe(true); // 5th allowed
        expect(limiter.check(ip)).toBe(false); // 6th blocked
    });
});
