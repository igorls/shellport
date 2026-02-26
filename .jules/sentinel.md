## 2025-02-18 - [Memory Leak in Rate Limiter]
**Vulnerability:** The rate limiter map (IP -> timestamps) in `src/server.ts` was never cleaned up, causing it to grow indefinitely with each new IP connection. This could lead to a Denial of Service (DoS) via memory exhaustion.
**Learning:** Simple in-memory rate limiters must always include a cleanup mechanism (e.g., periodic interval or TTL) to prevent memory leaks, especially when keying by user input (IP address).
**Prevention:** Implemented a periodic cleanup interval that removes stale entries (older than the rate limit window) from the `rateLimitMap`.

## 2025-02-18 - [DoS: Missing Max Message Size]
**Vulnerability:** The server accepted WebSocket messages of any size, attempting to buffer and process them. An attacker could send a massive message (e.g., 100MB+) to exhaust server memory (OOM), causing a Denial of Service.
**Learning:** WebSocket libraries/frameworks (like Bun's) may not enforce strict message size limits by default, or may default to large limits. Explicit application-level checks are critical for untrusted inputs.
**Prevention:** Implemented `MAX_MESSAGE_SIZE` (1MB) check in the WebSocket `message` handler to reject oversized messages immediately before processing.
