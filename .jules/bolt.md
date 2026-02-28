## 2025-02-28 - [Canvas Background Overdraw Optimization]
**Learning:** In canvas-based terminal emulators, drawing the default background color for every cell causes massive overdraw if the entire canvas is already cleared with the default background color each frame. Adding a check to skip `fillRect` when `cellBg === defaultBackground` dramatically reduces API calls (by ~74% in benchmarks).
**Action:** When working on canvas rendering, always look for opportunities to skip drawing operations that match the base/clear color of the canvas.
