# Bolt's Journal

## 2026-02-21 - Unbounded Rate Limit Map
**Learning:** The `rateLimitMap` in `src/server.ts` was leaking memory because entries for inactive IPs were never removed. This is a common pattern in simple rate limiters.
**Action:** Always implement a periodic cleanup mechanism (e.g., `setInterval`) for maps tracking client state to prevent indefinite growth.
