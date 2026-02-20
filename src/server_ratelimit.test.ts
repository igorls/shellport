import { describe, test, expect, afterEach } from "bun:test";
import { rateLimitMap, cleanupRateLimits, RATE_LIMIT_WINDOW_MS } from "./server.js";

describe("Rate Limiting Cleanup", () => {
    afterEach(() => {
        rateLimitMap.clear();
    });

    test("removes expired entries", () => {
        const ip = "1.2.3.4";
        const oldTimestamp = Date.now() - RATE_LIMIT_WINDOW_MS - 1000;

        rateLimitMap.set(ip, [oldTimestamp]);
        expect(rateLimitMap.has(ip)).toBe(true);

        cleanupRateLimits();

        expect(rateLimitMap.has(ip)).toBe(false);
    });

    test("keeps valid entries", () => {
        const ip = "5.6.7.8";
        const newTimestamp = Date.now();

        rateLimitMap.set(ip, [newTimestamp]);
        expect(rateLimitMap.has(ip)).toBe(true);

        cleanupRateLimits();

        expect(rateLimitMap.has(ip)).toBe(true);
        expect(rateLimitMap.get(ip)).toHaveLength(1);
    });

    test("prunes mixed entries", () => {
        const ip = "9.10.11.12";
        const oldTimestamp = Date.now() - RATE_LIMIT_WINDOW_MS - 1000;
        const newTimestamp = Date.now();

        rateLimitMap.set(ip, [oldTimestamp, newTimestamp]);

        cleanupRateLimits();

        expect(rateLimitMap.has(ip)).toBe(true);
        const timestamps = rateLimitMap.get(ip);
        expect(timestamps).toHaveLength(1);
        expect(timestamps![0]).toBe(newTimestamp);
    });
});
