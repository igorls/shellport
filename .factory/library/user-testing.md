# User Testing

Testing surface, resource cost classification per surface.

---

## Validation Surface

This mission validates a **static documentation website** built with VitePress.

### Primary Surface: Browser
- Tool: `agent-browser` skill
- Entry points:
  - Local dev server: `http://localhost:5173`
  - Deployed site: `https://igorls.github.io/shellport/`

### Testing Capabilities
- Navigate pages and verify content
- Test sidebar and header navigation
- Test search functionality
- Verify responsive design (mobile viewport)
- Check console for errors
- Verify external links (GitHub)

### Testing Limitations
- No authentication required for docs site
- No form submissions or complex interactions
- Static content only (no dynamic features)

---

## Validation Concurrency

### Resource Cost Profile
- **Agent-browser instance**: ~150-300 MB RAM per instance
- **VitePress dev server**: ~100 MB RAM
- **Total per validator**: ~400-500 MB RAM

### Machine Resources
Based on mission system info (check with `free -h` and `nproc`):
- Estimated total RAM: 16+ GB
- Estimated CPU cores: 4+
- Estimated available headroom: 12+ GB (after baseline)

### Max Concurrent Validators
Using 70% of available headroom:
- Available headroom: ~12 GB
- Safe capacity: 12 GB * 0.7 = **8.4 GB**
- Per validator: ~0.5 GB
- **Max concurrent: 5 validators**

However, since this is a docs site with minimal complexity:
- Most validation is sequential (navigation flows)
- Search testing requires single instance
- Mobile testing requires viewport resize, not parallel browsers

**Recommended concurrent: 3 validators** (sufficient headroom, no need for parallel testing on simple docs)

---

## Validation Flows

### Landing Page Validation
1. Navigate to `/`
2. Verify hero section renders
3. Verify feature grid displays 6 cards
4. Click "Get Started" → verify navigation to `/getting-started/installation`
5. Click "GitHub" link → verify opens in new tab

### Navigation Validation
1. Open sidebar
2. Click each section link
3. Verify page loads and sidebar highlights active page
4. Press Back/Forward → verify sidebar updates

### Search Validation
1. Press `/` or click search icon
2. Type query (e.g., "encryption")
3. Verify results appear
4. Click result → verify navigation

### Mobile Responsive Validation
1. Resize viewport to < 768px
2. Verify sidebar hidden, hamburger menu visible
3. Click hamburger → verify sidebar opens
4. Navigate via mobile sidebar

### GitHub Pages Validation
1. Navigate to deployed URL
2. Verify pages load without console errors
3. Verify navigation works
4. Verify all links resolve
