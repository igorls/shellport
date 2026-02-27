
import { describe, it, expect, mock, spyOn } from "bun:test";

// Mock Browser Environment
const globalAny = global as any;

globalAny.window = {
  devicePixelRatio: 1,
};

globalAny.document = {
  createElement: (tag: string) => {
    if (tag === 'canvas') {
      return new MockCanvas();
    }
    return {};
  },
  getElementById: () => null,
  addEventListener: () => {},
  removeEventListener: () => {},
};

globalAny.navigator = {
  clipboard: { writeText: async () => {} }
};

globalAny.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

globalAny.requestAnimationFrame = (fn: any) => fn();

class MockContext {
  fillStyle = '';
  font = '';
  textBaseline = '';

  // Track calls
  fillRect = mock(() => {});
  fillText = mock(() => {});
  measureText = () => ({ width: 8 });
  save = () => {};
  restore = () => {};
  translate = () => {};
  beginPath = () => {};
  moveTo = () => {};
  lineTo = () => {};
  stroke = () => {};
  setTransform = () => {};
}

class MockCanvas {
  width = 800;
  height = 600;
  style = {};
  getContext(type: string, opts: any) {
    return new MockContext();
  }
  addEventListener() {}
  getBoundingClientRect() {
    return { width: 800, height: 600, top: 0, left: 0 };
  }
  focus() {}
}

// Load NanoTermV2
const fs = require('fs');
const path = require('path');
const nanoTermCode = fs.readFileSync(path.resolve('src/frontend/nanoterm.js'), 'utf-8');

// Evaluate in global scope
eval(nanoTermCode + '; global.NanoTermV2 = NanoTermV2;');

describe('NanoTermV2 Performance', () => {
  it('should reduce unnecessary fillRect calls in renderRowBg', () => {
    const container = {
      appendChild: () => {},
      getBoundingClientRect: () => ({ width: 800, height: 600 })
    };

    const term = new globalAny.NanoTermV2(container, () => {});

    // Access the mocked context
    const ctx = term.ctx;

    // Reset mocks from initialization
    ctx.fillRect.mockClear();

    // Trigger render
    term.render();

    console.log(`fillRect calls: ${ctx.fillRect.mock.calls.length}`);

    // Standard expectation without optimization:
    // 1 call for global clear
    // + 1 call per row (24 rows default) if all default bg
    // = 25 calls

    // With optimization:
    // 1 call for global clear
    // 0 calls for rows (skipped)
    // = 1 call

    // We expect the count to be 1 after optimization
    expect(ctx.fillRect.mock.calls.length).toBe(1);
  });
});
