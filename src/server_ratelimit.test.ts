import { describe, test, expect, beforeEach } from "bun:test";
import { rateLimitMap, checkRateLimit, cleanupRateLimits } from "./server.js";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;

describe("Rate Limiter", () => {
    beforeEach(() => {
        rateLimitMap.clear();
    });

    test("checkRateLimit adds entries", () => {
        const ip = "1.2.3.4";
        expect(checkRateLimit(ip)).toBe(true);
        expect(rateLimitMap.has(ip)).toBe(true);
        expect(rateLimitMap.get(ip)?.length).toBe(1);
    });

    test("checkRateLimit respects max limit", () => {
        const ip = "1.2.3.4";
        for (let i = 0; i < RATE_LIMIT_MAX; i++) {
            expect(checkRateLimit(ip)).toBe(true);
        }
        expect(checkRateLimit(ip)).toBe(false);
        expect(rateLimitMap.get(ip)?.length).toBe(RATE_LIMIT_MAX);
    });

    test("cleanupRateLimits removes expired entries", () => {
        const ip = "1.2.3.4";
        const oldTimestamp = Date.now() - RATE_LIMIT_WINDOW_MS - 1000;

        // Manually inject old timestamp
        rateLimitMap.set(ip, [oldTimestamp]);

        cleanupRateLimits();

        expect(rateLimitMap.has(ip)).toBe(false);
    });

    test("cleanupRateLimits keeps recent entries", () => {
        const ip = "1.2.3.4";
        const recentTimestamp = Date.now();

        rateLimitMap.set(ip, [recentTimestamp]);

        cleanupRateLimits();

        expect(rateLimitMap.has(ip)).toBe(true);
        expect(rateLimitMap.get(ip)?.length).toBe(1);
    });

    test("cleanupRateLimits partially cleans entries", () => {
        const ip = "1.2.3.4";
        const oldTimestamp = Date.now() - RATE_LIMIT_WINDOW_MS - 1000;
        const recentTimestamp = Date.now();

        rateLimitMap.set(ip, [oldTimestamp, recentTimestamp]);

        cleanupRateLimits();

        expect(rateLimitMap.has(ip)).toBe(true);
        expect(rateLimitMap.get(ip)?.length).toBe(1);
        expect(rateLimitMap.get(ip)?.[0]).toBe(recentTimestamp);
    });
});
