## 2026-03-03 - Render Loop Font Memoization
**Learning:** In highly frequently called inner render loops (like `NanoTermV2.renderRunText`), dynamically allocating arrays and using `join(' ')` for font string construction causes significant garbage collection pressure and performance degradation due to object churn.
**Action:** Use a `Map` (or precomputed cache) keyed by a bitmask of relevant flags (e.g., `flags & (ATTR.BOLD | ATTR.ITALIC)`) to memoize the font string, avoiding dynamic allocations on every frame. Cache must be cleared on resize or font size changes.
