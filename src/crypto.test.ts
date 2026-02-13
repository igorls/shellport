/**
 * ShellPort - Crypto Engine Tests
 *
 * Tests AES-256-GCM key derivation, message packing/unpacking,
 * round-trip integrity, and error handling.
 */

import { describe, test, expect } from "bun:test";
import { deriveKey, pack, unpack, getCryptoJS } from "./crypto.js";
import { FrameType } from "./types.js";

// ---------------------------------------------------------------------------
// deriveKey
// ---------------------------------------------------------------------------
describe("deriveKey", () => {
    test("returns a CryptoKey for a valid secret", async () => {
        const key = await deriveKey("test-secret");
        expect(key).not.toBeNull();
        expect(key).toBeInstanceOf(CryptoKey);
    });

    test("returns null for empty string (plaintext mode)", async () => {
        const key = await deriveKey("");
        expect(key).toBeNull();
    });

    test("same secret produces compatible keys", async () => {
        const key1 = await deriveKey("same-secret");
        const key2 = await deriveKey("same-secret");

        // Encrypt with key1, decrypt with key2 — must succeed
        const payload = new TextEncoder().encode("hello");
        const packed = await pack(key1, FrameType.DATA, payload);
        const decoded = await unpack(key2, packed.buffer as ArrayBuffer);

        expect(decoded).not.toBeNull();
        expect(decoded!.type).toBe(FrameType.DATA);
        expect(new TextDecoder().decode(decoded!.payload)).toBe("hello");
    });
});

// ---------------------------------------------------------------------------
// pack / unpack round-trip
// ---------------------------------------------------------------------------
describe("pack / unpack", () => {
    test("round-trip with encryption preserves type and payload", async () => {
        const key = await deriveKey("round-trip-key");
        const payload = new TextEncoder().encode("encrypted message");

        const packed = await pack(key, FrameType.DATA, payload);
        const decoded = await unpack(key, packed.buffer as ArrayBuffer);

        expect(decoded).not.toBeNull();
        expect(decoded!.type).toBe(FrameType.DATA);
        expect(new TextDecoder().decode(decoded!.payload)).toBe("encrypted message");
    });

    test("round-trip without encryption (plaintext mode)", async () => {
        const payload = new TextEncoder().encode("plaintext message");

        const packed = await pack(null, FrameType.CONTROL, payload);
        const decoded = await unpack(null, packed.buffer as ArrayBuffer);

        expect(decoded).not.toBeNull();
        expect(decoded!.type).toBe(FrameType.CONTROL);
        expect(new TextDecoder().decode(decoded!.payload)).toBe("plaintext message");
    });

    test("round-trip preserves binary payload", async () => {
        const key = await deriveKey("binary-key");
        const payload = new Uint8Array([0x00, 0xff, 0x42, 0x80, 0x01]);

        const packed = await pack(key, FrameType.DATA, payload);
        const decoded = await unpack(key, packed.buffer as ArrayBuffer);

        expect(decoded).not.toBeNull();
        expect(decoded!.type).toBe(FrameType.DATA);
        expect(Array.from(decoded!.payload)).toEqual([0x00, 0xff, 0x42, 0x80, 0x01]);
    });

    test("round-trip with empty payload", async () => {
        const key = await deriveKey("empty-payload");
        const payload = new Uint8Array(0);

        const packed = await pack(key, FrameType.DATA, payload);
        const decoded = await unpack(key, packed.buffer as ArrayBuffer);

        expect(decoded).not.toBeNull();
        expect(decoded!.type).toBe(FrameType.DATA);
        expect(decoded!.payload.length).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// pack output format
// ---------------------------------------------------------------------------
describe("pack output format", () => {
    test("encrypted: [iv(12)][ciphertext] — at least 29 bytes", async () => {
        const key = await deriveKey("format-key");
        const payload = new TextEncoder().encode("x");

        const packed = await pack(key, FrameType.DATA, payload);

        // 12 (IV) + 1 (type) + 1 (payload "x") + 16 (GCM tag) = 30 minimum
        expect(packed.length).toBeGreaterThanOrEqual(29);
    });

    test("plaintext: [type(1)][payload] — exact size", async () => {
        const payload = new TextEncoder().encode("hello");

        const packed = await pack(null, FrameType.DATA, payload);

        // 1 (type byte) + 5 (payload "hello")
        expect(packed.length).toBe(6);
        expect(packed[0]).toBe(FrameType.DATA);
        expect(new TextDecoder().decode(packed.slice(1))).toBe("hello");
    });
});

// ---------------------------------------------------------------------------
// unpack error handling
// ---------------------------------------------------------------------------
describe("unpack error handling", () => {
    test("wrong key returns null", async () => {
        const keyA = await deriveKey("key-alpha");
        const keyB = await deriveKey("key-beta");

        const packed = await pack(keyA, FrameType.DATA, new TextEncoder().encode("secret"));
        const decoded = await unpack(keyB, packed.buffer as ArrayBuffer);

        expect(decoded).toBeNull();
    });

    test("truncated data (< 29 bytes) returns null", async () => {
        const key = await deriveKey("truncation-key");
        const shortData = new Uint8Array(20); // Too short for IV + ciphertext + tag

        const decoded = await unpack(key, shortData.buffer as ArrayBuffer);
        expect(decoded).toBeNull();
    });

    test("corrupted ciphertext returns null", async () => {
        const key = await deriveKey("corruption-key");
        const packed = await pack(key, FrameType.DATA, new TextEncoder().encode("data"));

        // Corrupt a byte in the ciphertext (after the 12-byte IV)
        const corrupted = new Uint8Array(packed);
        corrupted[20] ^= 0xff;

        const decoded = await unpack(key, corrupted.buffer as ArrayBuffer);
        expect(decoded).toBeNull();
    });

    test("empty buffer returns null (encrypted mode)", async () => {
        const key = await deriveKey("empty-key");
        const decoded = await unpack(key, new ArrayBuffer(0));
        expect(decoded).toBeNull();
    });

    test("empty buffer returns null (plaintext mode)", async () => {
        const decoded = await unpack(null, new ArrayBuffer(0));
        expect(decoded).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// getCryptoJS
// ---------------------------------------------------------------------------
describe("getCryptoJS", () => {
    test("returns a non-empty string containing key functions", () => {
        const js = getCryptoJS();

        expect(typeof js).toBe("string");
        expect(js.length).toBeGreaterThan(0);
        expect(js).toContain("deriveKey");
        expect(js).toContain("pack");
        expect(js).toContain("unpack");
        expect(js).toContain("SeqQueue");
    });
});
