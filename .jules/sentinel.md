## 2025-02-18 - [Memory Leak in Rate Limiter]
**Vulnerability:** The rate limiter map (IP -> timestamps) in `src/server.ts` was never cleaned up, causing it to grow indefinitely with each new IP connection. This could lead to a Denial of Service (DoS) via memory exhaustion.
**Learning:** Simple in-memory rate limiters must always include a cleanup mechanism (e.g., periodic interval or TTL) to prevent memory leaks, especially when keying by user input (IP address).
**Prevention:** Implemented a periodic cleanup interval that removes stale entries (older than the rate limit window) from the `rateLimitMap`.

## 2025-02-18 - [DoS via Rate Limiter Map Exhaustion]
**Vulnerability:** The rate limiter map in `src/server.ts` was unbounded, allowing an attacker to exhaust server memory by spoofing many unique IP addresses, even with cleanup logic in place.
**Learning:** Cleanup mechanisms are insufficient against rapid attacks; hard limits on data structure size are necessary for security-critical components exposed to unauthenticated input.
**Prevention:** Enforced a `MAX_TRACKED_IPS` limit (1000) on the `rateLimitMap`, rejecting new IPs when the limit is reached.
