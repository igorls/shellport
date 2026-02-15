/**
 * Rate Limiter with automatic cleanup
 *
 * Implements a sliding window rate limiter per IP address.
 * Includes a cleanup mechanism to prevent memory leaks from old IP entries.
 */

export const RATE_LIMIT_MAX = 5;
export const RATE_LIMIT_WINDOW_MS = 60_000;

export class RateLimiter {
    private map = new Map<string, number[]>();
    private cleanupTimer: ReturnType<typeof setInterval> | null = null;

    constructor() {
        // Initialize map
        this.map = new Map<string, number[]>();
    }

    /**
     * Check if a request from the given IP is allowed.
     * Records the request timestamp if allowed.
     */
    check(ip: string): boolean {
        const now = Date.now();
        const windowStart = now - RATE_LIMIT_WINDOW_MS;
        let timestamps = this.map.get(ip);

        if (!timestamps) {
            this.map.set(ip, [now]);
            return true;
        }

        // Prune timestamps outside the window
        timestamps = timestamps.filter(t => t > windowStart);

        if (timestamps.length >= RATE_LIMIT_MAX) {
            this.map.set(ip, timestamps);
            return false;
        }

        timestamps.push(now);
        this.map.set(ip, timestamps);
        return true;
    }

    /**
     * Remove entries that have no timestamps within the current window.
     * This method iterates over the entire map.
     */
    cleanup() {
        const now = Date.now();
        const windowStart = now - RATE_LIMIT_WINDOW_MS;

        // Iterate over keys to allow deletion during iteration
        for (const [ip, timestamps] of this.map) {
            const validTimestamps = timestamps.filter(t => t > windowStart);

            if (validTimestamps.length === 0) {
                this.map.delete(ip);
            } else if (validTimestamps.length !== timestamps.length) {
                this.map.set(ip, validTimestamps);
            }
        }
    }

    /**
     * Start the periodic cleanup task.
     * @param intervalMs Interval in milliseconds (default: 60000)
     */
    startCleanupInterval(intervalMs: number = 60000) {
        if (this.cleanupTimer) clearInterval(this.cleanupTimer);
        this.cleanupTimer = setInterval(() => this.cleanup(), intervalMs);
        // Allow the process to exit even if the interval is running
        if (this.cleanupTimer && typeof this.cleanupTimer.unref === 'function') {
            this.cleanupTimer.unref();
        }
    }

    /**
     * Stop the cleanup task.
     */
    stopCleanupInterval() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
    }

    /**
     * Get the number of tracked IPs (for testing/monitoring)
     */
    get size(): number {
        return this.map.size;
    }
}
