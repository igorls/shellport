## 2025-02-18 - [Memory Leak in Rate Limiter]
**Vulnerability:** The rate limiter map (IP -> timestamps) in `src/server.ts` was never cleaned up, causing it to grow indefinitely with each new IP connection. This could lead to a Denial of Service (DoS) via memory exhaustion.
**Learning:** Simple in-memory rate limiters must always include a cleanup mechanism (e.g., periodic interval or TTL) to prevent memory leaks, especially when keying by user input (IP address).
**Prevention:** Implemented a periodic cleanup interval that removes stale entries (older than the rate limit window) from the `rateLimitMap`.

## 2025-02-18 - [Memory Exhaustion DoS via Unbounded WebSocket Messages]
**Vulnerability:** The WebSocket server configuration omitted a `maxPayloadLength` constraint. Because Bun natively allocates memory for incoming WebSocket payloads before invoking the handler, attackers could send multi-gigabyte payloads to crash the server with Out-Of-Memory (OOM) errors, leading to a Denial of Service.
**Learning:** Manually checking message sizes (e.g., `msg.byteLength`) inside the message handler is insufficient for DoS protection since the memory is already allocated. Framework-level configurations must be used to drop large frames before allocation.
**Prevention:** Always configure `maxPayloadLength` in `Bun.serve({ websocket: { maxPayloadLength: ... } })` to set a hard native boundary.
