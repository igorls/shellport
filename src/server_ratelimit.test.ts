import { describe, test, expect, beforeEach } from "bun:test";
import { rateLimitMap, cleanupRateLimits, checkRateLimit } from "./server";

describe("Rate Limiting", () => {
    // 60000 ms is RATE_LIMIT_WINDOW_MS
    const WINDOW_MS = 60000;

    beforeEach(() => {
        rateLimitMap.clear();
    });

    test("checkRateLimit tracks timestamps", () => {
        const ip = "1.2.3.4";
        expect(checkRateLimit(ip)).toBe(true);
        expect(rateLimitMap.has(ip)).toBe(true);
        expect(rateLimitMap.get(ip)?.length).toBe(1);
    });

    test("cleanupRateLimits removes stale entries", () => {
        const ipStale = "1.1.1.1";
        const ipFresh = "2.2.2.2";
        const ipMixed = "3.3.3.3";

        const now = Date.now();
        const oldTime = now - WINDOW_MS - 1000; // 1 second older than window
        const freshTime = now;

        rateLimitMap.set(ipStale, [oldTime]);
        rateLimitMap.set(ipFresh, [freshTime]);
        rateLimitMap.set(ipMixed, [oldTime, freshTime]);

        cleanupRateLimits();

        // Stale IP should be completely removed
        expect(rateLimitMap.has(ipStale)).toBe(false);

        // Fresh IP should remain
        expect(rateLimitMap.has(ipFresh)).toBe(true);
        expect(rateLimitMap.get(ipFresh)?.length).toBe(1);
        expect(rateLimitMap.get(ipFresh)?.[0]).toBe(freshTime);

        // Mixed IP should remain, but old timestamp removed
        expect(rateLimitMap.has(ipMixed)).toBe(true);
        expect(rateLimitMap.get(ipMixed)?.length).toBe(1);
        expect(rateLimitMap.get(ipMixed)?.[0]).toBe(freshTime);
    });
});
