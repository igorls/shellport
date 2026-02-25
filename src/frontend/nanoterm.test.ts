import { describe, test, expect, beforeAll } from "bun:test";
import fs from "fs";

// Mock browser globals
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);

global.window = {
    devicePixelRatio: 1,
    requestAnimationFrame: global.requestAnimationFrame,
} as any;

global.navigator = {
    clipboard: {
        writeText: async () => {},
    },
} as any;

global.ResizeObserver = class {
    observe() {}
    disconnect() {}
} as any;

const mockContext = {
    font: '',
    fillStyle: '',
    textBaseline: '',
    measureText: () => ({ width: 10 }),
    fillRect: () => {},
    fillText: () => {},
    save: () => {},
    restore: () => {},
    translate: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    setTransform: () => {},
};

global.document = {
    createElement: (tag: string) => {
        if (tag === 'canvas') {
            return {
                getContext: () => mockContext,
                addEventListener: () => {},
                getBoundingClientRect: () => ({ width: 800, height: 600, left: 0, top: 0 }),
                style: {},
                focus: () => {},
                classList: { add: () => {}, remove: () => {} },
                setAttribute: () => {},
                appendChild: () => {},
            };
        }
        return {};
    },
    getElementById: () => null,
    removeEventListener: () => {},
} as any;

// Load NanoTermV2 source
const nanotermSource = fs.readFileSync("src/frontend/nanoterm.js", "utf8");

// Eval to define NanoTermV2 in global scope
eval(nanotermSource + "; global.NanoTermV2 = NanoTermV2;");

// Expose ATTR constants for testing
const ATTR = {
    BOLD: 1 << 0,
    DIM: 1 << 1,
    ITALIC: 1 << 2,
    UNDERLINE: 1 << 3,
    BLINK: 1 << 4,
    INVERSE: 1 << 5,
    HIDDEN: 1 << 6,
    STRIKETHROUGH: 1 << 7,
    DOUBLE_UNDERLINE: 1 << 8,
    OVERLINE: 1 << 9
};

describe("NanoTermV2 Font Rendering", () => {
    let term: any;
    let container;

    beforeAll(() => {
        container = {
            appendChild: () => {},
            getBoundingClientRect: () => ({ width: 800, height: 600 }),
        };
        // @ts-ignore
        term = new NanoTermV2(container, () => {}, {
            fontSize: 14,
            fontFamily: 'monospace'
        });
    });

    test("renderRunText sets correct font string for normal text", () => {
        const row = [{ char: 'A', fg: 256, bg: 256, flags: 0 }];
        term.renderRunText(row, 0, 1, 0, 256, 256, 0);
        expect(mockContext.font).toBe("14px monospace");
    });

    test("renderRunText sets correct font string for bold text", () => {
        const row = [{ char: 'A', fg: 256, bg: 256, flags: ATTR.BOLD }];
        term.renderRunText(row, 0, 1, 0, 256, 256, ATTR.BOLD);
        expect(mockContext.font).toBe("bold 14px monospace");
    });

    test("renderRunText sets correct font string for italic text", () => {
        const row = [{ char: 'A', fg: 256, bg: 256, flags: ATTR.ITALIC }];
        term.renderRunText(row, 0, 1, 0, 256, 256, ATTR.ITALIC);
        expect(mockContext.font).toBe("italic 14px monospace");
    });

    test("renderRunText sets correct font string for bold italic text", () => {
        const row = [{ char: 'A', fg: 256, bg: 256, flags: ATTR.BOLD | ATTR.ITALIC }];
        term.renderRunText(row, 0, 1, 0, 256, 256, ATTR.BOLD | ATTR.ITALIC);
        expect(mockContext.font).toBe("bold italic 14px monospace");
    });
});
