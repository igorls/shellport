import { test, expect } from "bun:test";
import * as fs from "fs";
import * as path from "path";

// Mock browser environment
const mockCanvas = {
  getContext: () => ({
    measureText: () => ({ width: 10 }),
    fillRect: () => {},
    fillText: () => {},
    translate: () => {},
    save: () => {},
    restore: () => {},
    setTransform: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    beginPath: () => {},
  }),
  getBoundingClientRect: () => ({ width: 800, height: 600, left: 0, top: 0 }),
  style: {},
  addEventListener: () => {},
  focus: () => {},
};

const mockContainer = {
  appendChild: () => {},
  getBoundingClientRect: () => ({ width: 800, height: 600 }),
};

global.document = {
  createElement: (tag: string) => {
    if (tag === 'canvas') return mockCanvas;
    return {};
  },
  getElementById: () => null,
  addEventListener: () => {},
  removeEventListener: () => {},
} as any;

global.window = {
  devicePixelRatio: 1,
} as any;

global.requestAnimationFrame = (cb: any) => setTimeout(cb, 0) as any;
global.ResizeObserver = class {
  observe() {}
  disconnect() {}
} as any;
global.TextDecoder = class {
  decode(arr: any) { return String.fromCharCode(...arr); }
} as any;
global.navigator = {
  clipboard: {
    writeText: async () => {},
  }
} as any;

// Load NanoTermV2
const nanotermPath = path.join(process.cwd(), "src/frontend/nanoterm.js");
const nanotermSource = fs.readFileSync(nanotermPath, "utf-8");

// Eval to get NanoTermV2 class
// We append the class name to return it from eval
const NanoTermV2 = eval(nanotermSource + "; NanoTermV2;");

test("NanoTermV2: initialization sets dirty flags", () => {
  // @ts-ignore
  const term = new NanoTermV2(mockContainer, () => {});

  // Check initial state
  expect(term.needsFullRedraw).toBe(true);

  // Check rows are dirty
  const buffer = term.primaryBuffer;
  expect(buffer.length).toBeGreaterThan(0);
  expect(buffer[0].dirty).toBe(true);
});

test("NanoTermV2: putChar marks row dirty", () => {
  // @ts-ignore
  const term = new NanoTermV2(mockContainer, () => {});

  // Reset redraw flag
  term.needsFullRedraw = false;
  term.primaryBuffer.forEach((row: any) => row.dirty = false);

  // Write a character
  term.putChar('A');

  // Check if current row is dirty
  expect(term.primaryBuffer[0].dirty).toBe(true);

  // Check next row is NOT dirty
  expect(term.primaryBuffer[1].dirty).toBe(false);
});

test("NanoTermV2: scrollUp sets needsFullRedraw", () => {
  // @ts-ignore
  const term = new NanoTermV2(mockContainer, () => {});
  term.needsFullRedraw = false;

  term.scrollUp();

  expect(term.needsFullRedraw).toBe(true);
});

test("NanoTermV2: eraseLine marks row dirty", () => {
  // @ts-ignore
  const term = new NanoTermV2(mockContainer, () => {});
  term.needsFullRedraw = false;
  term.primaryBuffer[0].dirty = false;

  term.eraseLine(0);

  expect(term.primaryBuffer[0].dirty).toBe(true);
});
