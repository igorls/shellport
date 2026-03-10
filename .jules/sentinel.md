## 2025-02-18 - [WebSocket Memory Exhaustion DoS]
**Vulnerability:** The WebSocket server lacked a limit on incoming message sizes (`maxPayloadLength`), allowing an attacker to send excessively large payloads, causing Bun to allocate large amounts of memory and potentially crashing the server via OOM (Out Of Memory) conditions.
**Learning:** Checking `.length` or `.byteLength` inside the `message` handler is sub-optimal for DoS prevention because the framework (Bun) has already allocated memory for the payload by the time the handler is invoked. The limit must be enforced natively at the connection/server configuration level.
**Prevention:** Configured `maxPayloadLength: MAX_MESSAGE_SIZE` (1MB limit) on the `websocket` object in `Bun.serve` to reject oversized frames at the protocol level before memory allocation occurs.

## 2025-02-18 - [Memory Leak in Rate Limiter]
**Vulnerability:** The rate limiter map (IP -> timestamps) in `src/server.ts` was never cleaned up, causing it to grow indefinitely with each new IP connection. This could lead to a Denial of Service (DoS) via memory exhaustion.
**Learning:** Simple in-memory rate limiters must always include a cleanup mechanism (e.g., periodic interval or TTL) to prevent memory leaks, especially when keying by user input (IP address).
**Prevention:** Implemented a periodic cleanup interval that removes stale entries (older than the rate limit window) from the `rateLimitMap`.
