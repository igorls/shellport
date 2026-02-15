# Sentinel's Journal

## 2024-05-22 - Memory Leak in Rate Limiter
**Vulnerability:** Unbounded memory growth in `src/server.ts` due to `rateLimitMap` never cleaning up old IP entries.
**Learning:** In-memory caches/counters must always have eviction policies or TTLs to prevent DoS via resource exhaustion.
**Prevention:** Always implement cleanup mechanisms (like `setInterval` or weak references) for long-lived in-memory stores.
