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

    test("enforces maximum tracked IPs", () => {
        // Fill the map to the limit
        // We use a prefix to generate unique IPs
        for (let i = 0; i < MAX_TRACKED_IPS; i++) {
            rateLimitMap.set(`192.168.${Math.floor(i / 256)}.${i % 256}`, [Date.now()]);
        }

        expect(rateLimitMap.size).toBe(MAX_TRACKED_IPS);

        // Try to add one more unique IP
        const rejected = checkRateLimit("10.10.10.10");
        expect(rejected).toBe(false); // Should be rejected because map is full
        expect(rateLimitMap.has("10.10.10.10")).toBe(false);

        // Verify that existing IPs still work (if not rate limited themselves)
        const existingIP = "192.168.0.0";
        // existingIP has 1 timestamp from setup. Adding another should be fine.
        const accepted = checkRateLimit(existingIP);
        expect(accepted).toBe(true);
        expect(rateLimitMap.get(existingIP)?.length).toBe(2);

        // Manually remove an entry to simulate expiry/cleanup
        rateLimitMap.delete("192.168.0.1");

        // Now the new IP should be accepted
        const nowAccepted = checkRateLimit("10.10.10.10");
        expect(nowAccepted).toBe(true);
        expect(rateLimitMap.has("10.10.10.10")).toBe(true);
    });
});
