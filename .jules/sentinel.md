## 2025-02-18 - [Memory Leak in Rate Limiter]
**Vulnerability:** The rate limiter map (IP -> timestamps) in `src/server.ts` was never cleaned up, causing it to grow indefinitely with each new IP connection. This could lead to a Denial of Service (DoS) via memory exhaustion.
**Learning:** Simple in-memory rate limiters must always include a cleanup mechanism (e.g., periodic interval or TTL) to prevent memory leaks, especially when keying by user input (IP address).
**Prevention:** Implemented a periodic cleanup interval that removes stale entries (older than the rate limit window) from the `rateLimitMap`.

## 2025-02-18 - [Unbounded Rate Limiter Map Size]
**Vulnerability:** Even with periodic cleanup, the rate limiter map could grow unboundedly within the cleanup interval (60s) if attacked with unique IPs, leading to potential memory exhaustion or CPU spikes during cleanup.
**Learning:** Periodic cleanup is insufficient for high-velocity attacks. Hard limits on data structure size are necessary for robust DoS protection.
**Prevention:** Implemented `MAX_TRACKED_IPS` to cap the map size and reject new IPs when full.
