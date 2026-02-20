# Sentinel's Journal

## 2025-01-28 - Memory Leak in Rate Limiter
**Vulnerability:** The rate limiter map (`rateLimitMap`) in `src/server.ts` stored timestamps for every IP address that ever connected, without removing them.
**Learning:** Rate limiters that track unique identifiers (like IPs) must have a cleanup mechanism, otherwise they become a memory leak vector (DoS) over time.
**Prevention:** Always implement a periodic cleanup or expiration mechanism for in-memory caches or trackers that accept unbounded input.
