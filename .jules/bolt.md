
## 2024-05-14 - [Font string construction in canvas render loops]
**Learning:** Dynamic array-based string construction (`[...].join(' ')`) inside the hot loop of a custom terminal renderer (like Canvas2D terminal emulator) generates high garbage collection pressure and is a major architectural bottleneck, causing unnecessary overhead on every frame.
**Action:** Always memoize and cache font strings per-style by deriving a key based on attributes (e.g., bitmask flags) when doing heavy text rendering to mitigate unnecessary dynamic allocation.
