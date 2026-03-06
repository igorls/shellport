## 2024-05-24 - Rate limiter array allocation overhead
**Learning:** `Array.filter()` in a frequently called function like `checkRateLimit` causes unnecessary memory allocations and O(n) iteration overhead, triggering garbage collection pressure. Because timestamps in sliding window implementations are strictly ordered chronologically, iterating through the entire list is unnecessary.
**Action:** Use an in-place `while` loop with `.shift()` to prune older timestamps. This stops execution as soon as a timestamp within the window is found and avoids creating entirely new arrays on each request.
