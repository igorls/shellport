## 2026-02-19 - Memory Leak in Rate Limiter
**Vulnerability:** The IP-based rate limiter (`rateLimitMap`) grew indefinitely as new IPs connected, potentially leading to a Denial of Service (DoS) via memory exhaustion.
**Learning:** Simple in-memory caches or counters must always have a cleanup strategy (TTL or LRU) to prevent unbounded growth, especially when keyed by external input like IP addresses.
**Prevention:** Implement periodic cleanup intervals or use a dedicated cache library with TTL support for rate limiting.
