## 2025-02-18 - [Memory Leak in Rate Limiter]
**Learning:** The rate limiter uses a Map of IPs to arrays of timestamps, and while it periodically deletes entire IPs that haven't been seen in the window, it does not clean up individual old timestamps for active IPs during the cleanup cycle. They are only pruned when the IP makes another request.
**Action:** Wait, is there a memory leak? If an IP sends exactly 5 requests and then stops, those 5 timestamps stay in the array. But `cleanupRateLimits` deletes the whole IP if the newest timestamp is older than the window. So the whole array is deleted. However, what if a malicious IP sends 1 request every 59 seconds? The array will grow indefinitely because `checkRateLimit` prunes timestamps outside the window, BUT wait, `checkRateLimit` DOES prune timestamps! Let me check `checkRateLimit`.

## 2025-02-18 - [Array iteration in rate limiting]
**Learning:** Using `.filter()` on an array that is strictly ordered by insertion time is O(n) and allocates a new array on every request. Since timestamps are appended, we can just `.shift()` old timestamps from the beginning.
**Action:** When working with time-series sliding windows where elements are strictly ordered, use `.shift()` or a pointer to remove old entries instead of re-filtering the entire array.
