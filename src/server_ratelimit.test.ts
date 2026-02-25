import { describe, test, expect, afterEach } from "bun:test";
import { rateLimitMap, cleanupRateLimits, RATE_LIMIT_WINDOW_MS, checkRateLimit, MAX_TRACKED_IPS } from "./server.js";

describe("Rate Limit Cleanup", () => {
    afterEach(() => {
        rateLimitMap.clear();
    });

    test("removes stale entries", () => {
        const now = Date.now();
        // Add an entry that is older than the window
        // Simulate a timestamp from > 60s ago
        const staleTime = now - RATE_LIMIT_WINDOW_MS - 1000;
        rateLimitMap.set("10.0.0.1", [staleTime]);

        // Add an entry that is within the window
        const freshTime = now - 1000;
        rateLimitMap.set("10.0.0.2", [freshTime]);

        cleanupRateLimits();

        expect(rateLimitMap.has("10.0.0.1")).toBe(false); // Should be removed
        expect(rateLimitMap.has("10.0.0.2")).toBe(true);  // Should be kept
    });

    test("removes empty entries", () => {
        rateLimitMap.set("10.0.0.3", []);
        cleanupRateLimits();
        expect(rateLimitMap.has("10.0.0.3")).toBe(false);
    });

    test("keeps entries with at least one recent timestamp", () => {
        const now = Date.now();
        const staleTime = now - RATE_LIMIT_WINDOW_MS - 1000;
        const freshTime = now - 1000;

        // Even if some timestamps are old, if the last one is fresh, keep the entry.
        // (Individual timestamp pruning happens in checkRateLimit, this cleanup is for inactive IPs)
        rateLimitMap.set("10.0.0.4", [staleTime, freshTime]);

        cleanupRateLimits();

        expect(rateLimitMap.has("10.0.0.4")).toBe(true);
    });
});

describe("Max Tracked IPs Limit", () => {
    afterEach(() => {
        rateLimitMap.clear();
    });

    test("allows new IPs when map is not full", () => {
        rateLimitMap.clear();
        expect(checkRateLimit("1.1.1.1")).toBe(true);
        expect(rateLimitMap.has("1.1.1.1")).toBe(true);
    });

    test("rejects new IPs when map is full", () => {
        // Fill the map to the limit
        for (let i = 0; i < MAX_TRACKED_IPS; i++) {
            rateLimitMap.set(`10.0.0.${i}`, [Date.now()]);
        }

        expect(rateLimitMap.size).toBe(MAX_TRACKED_IPS);

        // Try to add one more
        expect(checkRateLimit("9.9.9.9")).toBe(false);
        expect(rateLimitMap.has("9.9.9.9")).toBe(false);
        expect(rateLimitMap.size).toBe(MAX_TRACKED_IPS);
    });

    test("allows existing IPs even when map is full", () => {
        // Fill the map
        for (let i = 0; i < MAX_TRACKED_IPS; i++) {
            rateLimitMap.set(`10.0.0.${i}`, [Date.now()]);
        }

        // Access an existing IP
        const existingIP = "10.0.0.0";
        expect(checkRateLimit(existingIP)).toBe(true);
        // Should have updated timestamp
        expect(rateLimitMap.get(existingIP)?.length).toBe(2);
    });
});
