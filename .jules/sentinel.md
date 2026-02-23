## 2025-02-18 - [Memory Leak in Rate Limiter]
**Vulnerability:** The rate limiter map (IP -> timestamps) in `src/server.ts` was never cleaned up, causing it to grow indefinitely with each new IP connection. This could lead to a Denial of Service (DoS) via memory exhaustion.
**Learning:** Simple in-memory rate limiters must always include a cleanup mechanism (e.g., periodic interval or TTL) to prevent memory leaks, especially when keying by user input (IP address).
**Prevention:** Implemented a periodic cleanup interval that removes stale entries (older than the rate limit window) from the `rateLimitMap`.
## 2025-02-18 - [Uncontrolled Resource Consumption in WebSocket]
**Vulnerability:** The WebSocket server accepted messages of unlimited size, which could be buffered into memory by the runtime and then processed by the application, leading to memory exhaustion (DoS).
**Learning:** WebSocket implementations (like Bun's) may buffer the entire message before calling the handler. Application-level checks are critical to reject oversized payloads early to prevent processing overhead and memory spikes.
**Prevention:** Implemented a strict `MAX_MESSAGE_SIZE` (1MB) check in the WebSocket `message` handler to close connections sending excessive data.
