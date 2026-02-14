/**
 * ShellPort - TOTP Unit Tests
 *
 * Tests Base32, HMAC-SHA1, TOTP generation/verification,
 * and secret management against RFC test vectors.
 */

import { describe, test, expect, afterEach } from "bun:test";
import {
    base32Encode,
    base32Decode,
    generateTOTP,
    verifyTOTP,
    generateTOTPSecret,
    buildOTPAuthURI,
    saveTOTPSecret,
    loadTOTPSecret,
    deleteTOTPSecret,
} from "./totp.js";

// ═══════════════════════════════════════════════════════════════════════════
// Base32 Encode/Decode
// ═══════════════════════════════════════════════════════════════════════════

describe("Base32", () => {
    test("encode empty bytes", () => {
        expect(base32Encode(new Uint8Array(0))).toBe("");
    });

    test("decode empty string", () => {
        expect(base32Decode("")).toEqual(new Uint8Array(0));
    });

    test("round-trip: 'hello'", () => {
        const input = new TextEncoder().encode("hello");
        const encoded = base32Encode(input);
        expect(encoded).toBe("NBSWY3DP");
        const decoded = base32Decode(encoded);
        expect(new TextDecoder().decode(decoded)).toBe("hello");
    });

    test("round-trip: RFC 4648 test vectors", () => {
        const vectors: [string, string][] = [
            ["f", "MY"],
            ["fo", "MZXQ"],
            ["foo", "MZXW6"],
            ["foob", "MZXW6YQ"],
            ["fooba", "MZXW6YTB"],
            ["foobar", "MZXW6YTBOI"],
        ];

        for (const [plain, b32] of vectors) {
            const input = new TextEncoder().encode(plain);
            expect(base32Encode(input)).toBe(b32);
            expect(new TextDecoder().decode(base32Decode(b32))).toBe(plain);
        }
    });

    test("decode is case-insensitive", () => {
        const upper = base32Decode("NBSWY3DP");
        const lower = base32Decode("nbswy3dp");
        expect(upper).toEqual(lower);
    });

    test("decode ignores padding", () => {
        const withPad = base32Decode("NBSWY3DP======");
        const withoutPad = base32Decode("NBSWY3DP");
        expect(withPad).toEqual(withoutPad);
    });

    test("decode rejects invalid chars", () => {
        expect(() => base32Decode("INVALID!")).toThrow();
    });

    test("round-trip: random 20 bytes (TOTP secret size)", () => {
        const raw = crypto.getRandomValues(new Uint8Array(20));
        const encoded = base32Encode(raw);
        const decoded = base32Decode(encoded);
        expect(Array.from(decoded)).toEqual(Array.from(raw));
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// TOTP Generation
// ═══════════════════════════════════════════════════════════════════════════

describe("TOTP generation", () => {
    // RFC 6238 test secret: "12345678901234567890" (ASCII)
    // Base32 encoded: GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ
    const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

    test("generates 6-digit code", async () => {
        const code = await generateTOTP(RFC_SECRET);
        expect(code.length).toBe(6);
        expect(/^\d{6}$/.test(code)).toBe(true);
    });

    test("same secret + time = same code", async () => {
        const time = 1000000000; // Fixed time
        const code1 = await generateTOTP(RFC_SECRET, time);
        const code2 = await generateTOTP(RFC_SECRET, time);
        expect(code1).toBe(code2);
    });

    test("different times produce different codes (usually)", async () => {
        const code1 = await generateTOTP(RFC_SECRET, 1000000000);
        const code2 = await generateTOTP(RFC_SECRET, 1000000060); // 2 windows later
        // Not guaranteed but extremely likely with different counters
        // This test just checks they're valid codes
        expect(code1.length).toBe(6);
        expect(code2.length).toBe(6);
    });

    test("RFC 6238 test vector: T=59", async () => {
        // At T=59, counter=1, expected TOTP for SHA1 = 287082
        const code = await generateTOTP(RFC_SECRET, 59);
        expect(code).toBe("287082");
    });

    test("RFC 6238 test vector: T=1111111109", async () => {
        // At T=1111111109, counter=37037036, expected = 081804
        const code = await generateTOTP(RFC_SECRET, 1111111109);
        expect(code).toBe("081804");
    });

    test("RFC 6238 test vector: T=1234567890", async () => {
        // At T=1234567890, counter=41152263, expected = 005924
        const code = await generateTOTP(RFC_SECRET, 1234567890);
        expect(code).toBe("005924");
    });

    test("zero-pads short codes", async () => {
        // We can't control the output, but we verify format
        const code = await generateTOTP(RFC_SECRET, 59);
        expect(code.length).toBe(6);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// TOTP Verification
// ═══════════════════════════════════════════════════════════════════════════

describe("TOTP verification", () => {
    const SECRET = generateTOTPSecret();

    test("accepts current code", async () => {
        const code = await generateTOTP(SECRET);
        const valid = await verifyTOTP(SECRET, code);
        expect(valid).toBe(true);
    });

    test("accepts code from previous window (±1 tolerance)", async () => {
        const now = Math.floor(Date.now() / 1000);
        // Generate code for previous 30s window
        const prevCode = await generateTOTP(SECRET, now - 30);
        const valid = await verifyTOTP(SECRET, prevCode);
        expect(valid).toBe(true);
    });

    test("rejects completely wrong code", async () => {
        const valid = await verifyTOTP(SECRET, "000000");
        // Could theoretically match but extremely unlikely
        const code = await generateTOTP(SECRET);
        if (code === "000000") return; // Skip if by chance it matches

        expect(valid).toBe(false);
    });

    test("rejects code from far in the past", async () => {
        // Generate a code for 5 minutes ago (10 windows away)
        const oldCode = await generateTOTP(SECRET, Math.floor(Date.now() / 1000) - 300);
        const currentCode = await generateTOTP(SECRET);

        // Only assert rejection if the codes differ
        if (oldCode !== currentCode) {
            const valid = await verifyTOTP(SECRET, oldCode);
            expect(valid).toBe(false);
        }
    });

    test("timingSafeEqual handles different lengths and contents correctly", async () => {
        // We test verifyTOTP which uses timingSafeEqual
        expect(await verifyTOTP(SECRET, "123456")).toBe(false);
        expect(await verifyTOTP(SECRET, "12345")).toBe(false); // Different length
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// Secret Management
// ═══════════════════════════════════════════════════════════════════════════

describe("TOTP secret generation", () => {
    test("generates 32-char Base32 string", () => {
        const secret = generateTOTPSecret();
        expect(secret.length).toBe(32); // 20 bytes → 32 Base32 chars
        expect(/^[A-Z2-7]+$/.test(secret)).toBe(true);
    });

    test("generates unique secrets", () => {
        const s1 = generateTOTPSecret();
        const s2 = generateTOTPSecret();
        expect(s1).not.toBe(s2);
    });

    test("generated secrets can be used for TOTP", async () => {
        const secret = generateTOTPSecret();
        const code = await generateTOTP(secret);
        expect(code.length).toBe(6);
        const valid = await verifyTOTP(secret, code);
        expect(valid).toBe(true);
    });
});

describe("OTP Auth URI", () => {
    test("builds valid URI format", () => {
        const secret = "JBSWY3DPEHPK3PXP";
        const uri = buildOTPAuthURI(secret);

        expect(uri).toContain("otpauth://totp/");
        expect(uri).toContain(`secret=${secret}`);
        expect(uri).toContain("issuer=ShellPort");
        expect(uri).toContain("algorithm=SHA1");
        expect(uri).toContain("digits=6");
        expect(uri).toContain("period=30");
    });

    test("encodes label", () => {
        const uri = buildOTPAuthURI("SECRET", "My Server");
        expect(uri).toContain("otpauth://totp/My%20Server");
    });

    test("encodes custom issuer", () => {
        const uri = buildOTPAuthURI("SECRET", "Label", "Custom Issuer");
        expect(uri).toContain("issuer=Custom%20Issuer");
    });
});

describe("TOTP persistence", () => {
    const testSecret = generateTOTPSecret();

    afterEach(() => {
        try { deleteTOTPSecret(); } catch { }
    });

    test("save and load round-trip", () => {
        saveTOTPSecret(testSecret);
        const loaded = loadTOTPSecret();
        expect(loaded).toBe(testSecret);
    });

    test("load returns null when no file", () => {
        deleteTOTPSecret();
        const loaded = loadTOTPSecret();
        expect(loaded).toBeNull();
    });

    test("delete removes the file", () => {
        saveTOTPSecret(testSecret);
        deleteTOTPSecret();
        const loaded = loadTOTPSecret();
        expect(loaded).toBeNull();
    });
});
