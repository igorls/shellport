## 2025-02-18 - [Memory Leak in Rate Limiter]
**Vulnerability:** The rate limiter map (IP -> timestamps) in `src/server.ts` was never cleaned up, causing it to grow indefinitely with each new IP connection. This could lead to a Denial of Service (DoS) via memory exhaustion.
**Learning:** Simple in-memory rate limiters must always include a cleanup mechanism (e.g., periodic interval or TTL) to prevent memory leaks, especially when keying by user input (IP address).
**Prevention:** Implemented a periodic cleanup interval that removes stale entries (older than the rate limit window) from the `rateLimitMap`.

## 2025-02-18 - [Memory Exhaustion DoS via WebSocket Messages]
**Vulnerability:** The WebSocket `message` handler in `src/server.ts` accepted incoming payload buffers of unrestricted size. An attacker could intentionally send massive, multi-gigabyte payloads to crash the process through memory exhaustion.
**Learning:** Raw protocol handlers (like `bun` WebSocket `message` events) must proactively enforce payload bounds on every incoming message.
**Prevention:** Defined a strict `MAX_MESSAGE_SIZE` (e.g., 1MB) and added a proactive size check inside the `message` event handler before processing or buffering. Connection gets dropped with status 1009 (Message Too Big) if the limit is exceeded.
