## 2024-05-23 - Canvas Terminal Partial Rendering
**Learning:** In canvas-based terminal emulators, tracking dirty rows and only redrawing changed areas significantly reduces CPU usage during typing and idling (cursor blink), compared to full frame redraws.
**Action:** When optimizing canvas render loops, always look for opportunities to implement damage tracking (dirty rects) to avoid clearing and redrawing static content.
