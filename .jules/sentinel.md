## 2025-02-18 - [Memory Leak in Rate Limiter]
**Vulnerability:** The rate limiter map (IP -> timestamps) in `src/server.ts` was never cleaned up, causing it to grow indefinitely with each new IP connection. This could lead to a Denial of Service (DoS) via memory exhaustion.
**Learning:** Simple in-memory rate limiters must always include a cleanup mechanism (e.g., periodic interval or TTL) to prevent memory leaks, especially when keying by user input (IP address).
**Prevention:** Implemented a periodic cleanup interval that removes stale entries (older than the rate limit window) from the `rateLimitMap`.

## 2025-02-18 - [DoS Protection via Limits]
**Vulnerability:** The WebSocket server lacked a maximum message size limit, and the rate limiter map lacked a maximum entry count. This allowed attackers to cause Denial of Service (DoS) via memory exhaustion by sending huge messages or flooding with spoofed IPs.
**Learning:** Always enforce strict upper bounds on all unbounded resources (buffers, maps, queues) that are influenced by user input.
**Prevention:** Implemented `MAX_MESSAGE_SIZE` (1MB) check on incoming WebSocket messages and `MAX_TRACKED_IPS` (1000) check on the rate limiter map.
