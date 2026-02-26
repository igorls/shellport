import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import fs from 'fs';
import path from 'path';

// Mock browser globals
const mockContext = {
    font: '',
    fillStyle: '',
    fillRect: mock(() => {}),
    fillText: mock(() => {}),
    measureText: () => ({ width: 10 }),
    save: mock(() => {}),
    restore: mock(() => {}),
    translate: mock(() => {}),
    scale: mock(() => {}),
    setTransform: mock(() => {}),
    beginPath: mock(() => {}),
    moveTo: mock(() => {}),
    lineTo: mock(() => {}),
    stroke: mock(() => {}),
    createImageData: mock(() => {}),
    putImageData: mock(() => {}),
    getImageData: mock(() => {}),
};

const mockCanvas = {
    getContext: () => mockContext,
    width: 800,
    height: 600,
    style: {},
    getBoundingClientRect: () => ({ width: 800, height: 600, left: 0, top: 0 }),
    addEventListener: mock(() => {}),
    removeEventListener: mock(() => {}),
    focus: mock(() => {}),
    parentNode: { removeChild: mock(() => {}) },
};

const mockDocument = {
    createElement: (tag: string) => {
        if (tag === 'canvas') return mockCanvas;
        return { style: {}, classList: { add: () => {}, remove: () => {} } };
    },
    getElementById: () => ({ style: {}, classList: { add: () => {}, remove: () => {} } }),
    addEventListener: mock(() => {}),
    removeEventListener: mock(() => {}),
};

const mockWindow = {
    devicePixelRatio: 1,
    requestAnimationFrame: (cb: Function) => cb(),
    addEventListener: mock(() => {}),
    removeEventListener: mock(() => {}),
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    getComputedStyle: () => ({ fontFamily: 'monospace', fontSize: '14px' }),
};

global.document = mockDocument as any;
global.window = mockWindow as any;
global.navigator = { clipboard: { writeText: async () => {} } } as any;
global.requestAnimationFrame = mockWindow.requestAnimationFrame;
global.ResizeObserver = mockWindow.ResizeObserver;
global.TextDecoder = class { decode(arr: any) { return String.fromCharCode(...arr); } } as any;

// Load NanoTermV2
const nanotermPath = path.join(import.meta.dir, 'nanoterm.js');
const nanotermCode = fs.readFileSync(nanotermPath, 'utf8');
eval(nanotermCode + '; global.NanoTermV2 = NanoTermV2;');

describe('NanoTermV2 Rendering', () => {
    let term: any;
    let container: any;

    beforeEach(() => {
        mockContext.fillRect.mockClear();
        container = {
            appendChild: mock(() => {}),
            getBoundingClientRect: () => ({ width: 800, height: 600 }),
        };
        // @ts-ignore
        term = new global.NanoTermV2(container, () => {});
    });

    it('should avoid overdrawing default background', () => {
        // Reset metrics to ensure we have expected dimensions
        term.cols = 80;
        term.rows = 24;
        term.resize();

        // Clear mock calls from initialization
        mockContext.fillRect.mockClear();

        // Force a render
        term.render();

        // Count fillRect calls
        const fillRectCalls = mockContext.fillRect.mock.calls.length;
        console.log(`fillRect calls: ${fillRectCalls}`);

        // With optimization, we expect exactly 1 call (the global clear)
        // because all cells are empty/default background.
        expect(fillRectCalls).toBe(1);
    });
});
