/**
 * ShellPort - Crypto Engine Tests
 *
 * Tests AES-256-GCM key derivation, message packing/unpacking,
 * round-trip integrity, and error handling.
 */

import { describe, test, expect } from "bun:test";
import { deriveKey, pack, unpack, getCryptoJS, generateNonce, generateSecret, deriveSessionSalt, PROTOCOL_VERSION } from "./crypto.js";
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

    test("same secret with same session salt produces compatible keys", async () => {
        const serverNonce = generateNonce();
        const clientNonce = generateNonce();
        const sessionSalt = await deriveSessionSalt(serverNonce, clientNonce);

        const key1 = await deriveKey("session-secret", sessionSalt);
        const key2 = await deriveKey("session-secret", sessionSalt);

        expect(key1).not.toBeNull();
        expect(key2).not.toBeNull();

        const payload = new TextEncoder().encode("session data");
        const packed = await pack(key1, FrameType.DATA, payload);
        const decoded = await unpack(key2, packed.buffer as ArrayBuffer);

        expect(decoded).not.toBeNull();
        expect(new TextDecoder().decode(decoded!.payload)).toBe("session data");
    });

    test("different nonces produce different keys", async () => {
        const nonce1 = generateNonce();
        const nonce2 = generateNonce();
        const salt1 = await deriveSessionSalt(nonce1, generateNonce());
        const salt2 = await deriveSessionSalt(nonce2, generateNonce());

        const key1 = await deriveKey("same-secret", salt1);
        const key2 = await deriveKey("same-secret", salt2);

        const payload = new TextEncoder().encode("test");
        const packed = await pack(key1, FrameType.DATA, payload);
        const decoded = await unpack(key2, packed.buffer as ArrayBuffer);

        // Different salts should produce incompatible keys
        expect(decoded).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// generateNonce & generateSecret
// ---------------------------------------------------------------------------
describe("generateNonce", () => {
    test("generates 16-byte nonce by default", () => {
        const nonce = generateNonce();
        expect(nonce.length).toBe(16);
    });

    test("generates unique nonces", () => {
        const nonce1 = generateNonce();
        const nonce2 = generateNonce();
        expect(nonce1).not.toEqual(nonce2);
    });
});

describe("generateSecret", () => {
    test("generates 16-byte secret by default (128 bits)", () => {
        const secret = generateSecret();
        // base64url of 16 bytes = 22 chars (no padding)
        expect(secret.length).toBe(22);
    });

    test("generates unique secrets", () => {
        const secret1 = generateSecret();
        const secret2 = generateSecret();
        expect(secret1).not.toBe(secret2);
    });

    test("respects custom byte length", () => {
        const secret = generateSecret(32);
        // base64url of 32 bytes = 43 chars (no padding)
        expect(secret.length).toBe(43);
    });
});

// ---------------------------------------------------------------------------
// deriveSessionSalt
// ---------------------------------------------------------------------------
describe("deriveSessionSalt", () => {
    test("produces 32-byte SHA-256 hash", async () => {
        const serverNonce = generateNonce();
        const clientNonce = generateNonce();
        const salt = await deriveSessionSalt(serverNonce, clientNonce);

        expect(salt.length).toBe(32);
    });

    test("same inputs produce same salt", async () => {
        const serverNonce = generateNonce();
        const clientNonce = generateNonce();

        const salt1 = await deriveSessionSalt(serverNonce, clientNonce);
        const salt2 = await deriveSessionSalt(serverNonce, clientNonce);

        expect(salt1).toEqual(salt2);
    });

    test("different server nonces produce different salts", async () => {
        const clientNonce = generateNonce();
        const salt1 = await deriveSessionSalt(generateNonce(), clientNonce);
        const salt2 = await deriveSessionSalt(generateNonce(), clientNonce);

        expect(salt1).not.toEqual(salt2);
    });

    test("different client nonces produce different salts", async () => {
        const serverNonce = generateNonce();
        const salt1 = await deriveSessionSalt(serverNonce, generateNonce());
        const salt2 = await deriveSessionSalt(serverNonce, generateNonce());

        expect(salt1).not.toEqual(salt2);
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

    test("round-trip with session salt", async () => {
        const salt = await deriveSessionSalt(generateNonce(), generateNonce());
        const key = await deriveKey("session-key-test", salt);
        const payload = new TextEncoder().encode("per-session data");

        const packed = await pack(key, FrameType.DATA, payload);
        const decoded = await unpack(key, packed.buffer as ArrayBuffer);

        expect(decoded).not.toBeNull();
        expect(new TextDecoder().decode(decoded!.payload)).toBe("per-session data");
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

    test("all frame types work", async () => {
        const key = await deriveKey("frame-types");
        const payload = new TextEncoder().encode("test");

        for (const type of [FrameType.DATA, FrameType.CONTROL, FrameType.SERVER_NONCE, FrameType.CLIENT_NONCE]) {
            const packed = await pack(key, type, payload);
            const decoded = await unpack(key, packed.buffer as ArrayBuffer);
            expect(decoded!.type).toBe(type);
        }
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

    test("wrong session salt returns null", async () => {
        const salt1 = await deriveSessionSalt(generateNonce(), generateNonce());
        const salt2 = await deriveSessionSalt(generateNonce(), generateNonce());

        const key1 = await deriveKey("same-secret", salt1);
        const key2 = await deriveKey("same-secret", salt2);

        const packed = await pack(key1, FrameType.DATA, new TextEncoder().encode("session data"));
        const decoded = await unpack(key2, packed.buffer as ArrayBuffer);

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
        expect(js).toContain("deriveSessionSalt");
        expect(js).toContain("generateNonce");
    });

    test("contains protocol version", () => {
        const js = getCryptoJS();
        expect(js).toContain(`v${PROTOCOL_VERSION}`);
    });
});
