## 2025-02-18 - [Memory Leak in Rate Limiter]
**Vulnerability:** The rate limiter map (IP -> timestamps) in `src/server.ts` was never cleaned up, causing it to grow indefinitely with each new IP connection. This could lead to a Denial of Service (DoS) via memory exhaustion.
**Learning:** Simple in-memory rate limiters must always include a cleanup mechanism (e.g., periodic interval or TTL) to prevent memory leaks, especially when keying by user input (IP address).
**Prevention:** Implemented a periodic cleanup interval that removes stale entries (older than the rate limit window) from the `rateLimitMap`.

## 2025-03-06 - [Memory Exhaustion via WebSocket Payload]
**Vulnerability:** The WebSocket server configuration in `src/server.ts` lacked a restriction on maximum message size. Attackers could send massive payloads, leading to memory exhaustion and DoS, because Bun allocates memory for the incoming payload before passing it to the `message` handler.
**Learning:** Manually checking message size using `.byteLength` inside a WebSocket handler is sub-optimal for preventing memory exhaustion DoS, because the framework has already allocated memory by the time the handler runs. Framework-level configurations must be used.
**Prevention:** Enforced `maxPayloadLength: MAX_MESSAGE_SIZE` inside the Bun.serve `websocket` configuration.
