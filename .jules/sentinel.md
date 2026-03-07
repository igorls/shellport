## 2026-03-07 - [Memory Exhaustion via Unbounded WebSocket Messages]
**Vulnerability:** The WebSocket server lacked a size limit for incoming messages, allowing an attacker to send massive payloads that consume excessive memory before the application logic can reject them.
**Learning:** Checking message sizes using `.length` or `.byteLength` inside the message handler is insufficient for DoS prevention because the runtime (Bun) has already allocated memory for the payload by the time the handler is invoked.
**Prevention:** Always enforce payload limits at the native/server level. In Bun, set `maxPayloadLength` in the `websocket` configuration of `Bun.serve` to reject oversized frames before memory allocation.

## 2025-02-18 - [Memory Leak in Rate Limiter]
**Vulnerability:** The rate limiter map (IP -> timestamps) in `src/server.ts` was never cleaned up, causing it to grow indefinitely with each new IP connection. This could lead to a Denial of Service (DoS) via memory exhaustion.
**Learning:** Simple in-memory rate limiters must always include a cleanup mechanism (e.g., periodic interval or TTL) to prevent memory leaks, especially when keying by user input (IP address).
**Prevention:** Implemented a periodic cleanup interval that removes stale entries (older than the rate limit window) from the `rateLimitMap`.
