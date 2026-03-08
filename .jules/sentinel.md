## 2025-02-18 - [Memory Leak in Rate Limiter]
**Vulnerability:** The rate limiter map (IP -> timestamps) in `src/server.ts` was never cleaned up, causing it to grow indefinitely with each new IP connection. This could lead to a Denial of Service (DoS) via memory exhaustion.
**Learning:** Simple in-memory rate limiters must always include a cleanup mechanism (e.g., periodic interval or TTL) to prevent memory leaks, especially when keying by user input (IP address).
**Prevention:** Implemented a periodic cleanup interval that removes stale entries (older than the rate limit window) from the `rateLimitMap`.

## 2025-02-18 - [WebSocket Memory Exhaustion DoS]
**Vulnerability:** The WebSocket server didn't enforce a maximum payload size natively via `Bun.serve` options. Malicious clients could send extremely large payloads causing Bun to allocate large amounts of memory before checking message sizes in the `message` handler, leading to an OOM/DoS condition.
**Learning:** Checking `.length` inside a `message` event handler is too late; memory is already allocated by the runtime. Framework-level options must be configured to discard oversized packets at the socket level.
**Prevention:** Configured `maxPayloadLength` to 1MB (`MAX_MESSAGE_SIZE`) within the `websocket` config block in `Bun.serve`.
