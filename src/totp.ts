/**
 * ShellPort - TOTP Authentication (RFC 6238)
 *
 * Zero-dependency TOTP implementation using Web Crypto API.
 * Compatible with Google Authenticator, Authy, 1Password, etc.
 *
 * Features:
 * - HMAC-SHA1 via crypto.subtle
 * - Base32 encode/decode (RFC 4648)
 * - TOTP generation & verification with ±1 window tolerance
 * - otpauth:// URI builder for QR code pairing
 * - Secret persistence to ~/.shellport/totp.key
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// ═══════════════════════════════════════════════════════════════════════════
// Base32 (RFC 4648)
// ═══════════════════════════════════════════════════════════════════════════

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * Encode raw bytes to Base32 (RFC 4648, no padding).
 */
export function base32Encode(data: Uint8Array): string {
    let result = "";
    let bits = 0;
    let value = 0;

    for (const byte of data) {
        value = (value << 8) | byte;
        bits += 8;

        while (bits >= 5) {
            bits -= 5;
            result += BASE32_ALPHABET[(value >>> bits) & 0x1f];
        }
    }

    // Flush remaining bits
    if (bits > 0) {
        result += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
    }

    return result;
}

/**
 * Decode a Base32 string (RFC 4648) to raw bytes.
 * Ignores padding ('=') and spaces, case-insensitive.
 */
export function base32Decode(encoded: string): Uint8Array {
    const cleaned = encoded.replace(/[= ]/g, "").toUpperCase();
    const output: number[] = [];
    let bits = 0;
    let value = 0;

    for (const char of cleaned) {
        const idx = BASE32_ALPHABET.indexOf(char);
        if (idx === -1) throw new Error(`Invalid Base32 character: ${char}`);

        value = (value << 5) | idx;
        bits += 5;

        if (bits >= 8) {
            bits -= 8;
            output.push((value >>> bits) & 0xff);
        }
    }

    return new Uint8Array(output);
}

// ═══════════════════════════════════════════════════════════════════════════
// HMAC-SHA1 via Web Crypto
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute HMAC-SHA1(key, message) using Web Crypto API.
 */
async function hmacSHA1(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
    const cryptoKey = await crypto.subtle.importKey(
        "raw",
        key as unknown as ArrayBuffer,
        { name: "HMAC", hash: { name: "SHA-1" } },
        false,
        ["sign"]
    );

    const signature = await crypto.subtle.sign("HMAC", cryptoKey, message as unknown as ArrayBuffer);
    return new Uint8Array(signature);
}

// ═══════════════════════════════════════════════════════════════════════════
// TOTP (RFC 6238)
// ═══════════════════════════════════════════════════════════════════════════

/** TOTP period in seconds */
const TOTP_PERIOD = 30;

/** Number of digits in the TOTP code */
const TOTP_DIGITS = 6;

/** Secret size in bytes (160-bit, standard for TOTP) */
const SECRET_BYTES = 20;

/**
 * Convert a counter value to an 8-byte big-endian Uint8Array.
 */
function counterToBytes(counter: number): Uint8Array {
    const buf = new Uint8Array(8);
    let c = counter;
    for (let i = 7; i >= 0; i--) {
        buf[i] = c & 0xff;
        c = Math.floor(c / 256);
    }
    return buf;
}

/**
 * Dynamic truncation (RFC 4226 §5.3).
 * Extracts a 4-byte code from the HMAC result.
 */
function dynamicTruncation(hmac: Uint8Array): number {
    const offset = hmac[hmac.length - 1] & 0x0f;
    return (
        ((hmac[offset] & 0x7f) << 24) |
        ((hmac[offset + 1] & 0xff) << 16) |
        ((hmac[offset + 2] & 0xff) << 8) |
        (hmac[offset + 3] & 0xff)
    );
}

/**
 * Generate a TOTP code for the given secret and time.
 * @param secret - Base32-encoded TOTP secret
 * @param timeSeconds - Unix timestamp in seconds (defaults to now)
 * @returns 6-digit TOTP code as a zero-padded string
 */
export async function generateTOTP(
    secret: string,
    timeSeconds?: number
): Promise<string> {
    const key = base32Decode(secret);
    const time = timeSeconds ?? Math.floor(Date.now() / 1000);
    const counter = Math.floor(time / TOTP_PERIOD);

    const hmac = await hmacSHA1(key, counterToBytes(counter));
    const code = dynamicTruncation(hmac) % Math.pow(10, TOTP_DIGITS);

    return code.toString().padStart(TOTP_DIGITS, "0");
}

/**
 * Constant-time comparison of two strings to prevent timing attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) {
        result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
}

/**
 * Verify a TOTP code against the current time ± 1 window.
 * This allows for 30 seconds of clock skew in either direction.
 *
 * @param secret - Base32-encoded TOTP secret
 * @param code - 6-digit code to verify
 * @returns true if the code is valid
 */
export async function verifyTOTP(secret: string, code: string): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);
    const paddedCode = code.padStart(TOTP_DIGITS, "0");

    let isValid = false;

    // Check current window and ±1 window (allows 30s clock skew)
    for (const offset of [-1, 0, 1]) {
        const time = now + offset * TOTP_PERIOD;
        const expected = await generateTOTP(secret, time);
        if (timingSafeEqual(expected, paddedCode)) {
            isValid = true;
        }
    }

    return isValid;
}

// ═══════════════════════════════════════════════════════════════════════════
// Secret Management
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a new random TOTP secret (160-bit, Base32 encoded).
 * Returns a 32-character Base32 string.
 */
export function generateTOTPSecret(): string {
    const raw = crypto.getRandomValues(new Uint8Array(SECRET_BYTES));
    return base32Encode(raw);
}

/**
 * Build an otpauth:// URI for QR code generation.
 * This URI format is understood by all major authenticator apps.
 */
export function buildOTPAuthURI(
    secret: string,
    label: string = "ShellPort",
    issuer: string = "ShellPort"
): string {
    const encodedLabel = encodeURIComponent(label);
    const encodedIssuer = encodeURIComponent(issuer);
    return `otpauth://totp/${encodedLabel}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Persistence (~/.shellport/totp.key)
// ═══════════════════════════════════════════════════════════════════════════

const SHELLPORT_DIR = join(homedir(), ".shellport");
const TOTP_KEY_FILE = join(SHELLPORT_DIR, "totp.key");

/**
 * Save TOTP secret to ~/.shellport/totp.key
 * Creates the directory if it doesn't exist.
 */
export function saveTOTPSecret(secret: string): void {
    if (!existsSync(SHELLPORT_DIR)) {
        mkdirSync(SHELLPORT_DIR, { mode: 0o700 });
    }
    writeFileSync(TOTP_KEY_FILE, secret, { mode: 0o600 });
}

/**
 * Load TOTP secret from ~/.shellport/totp.key
 * Returns null if the file doesn't exist.
 */
export function loadTOTPSecret(): string | null {
    if (!existsSync(TOTP_KEY_FILE)) return null;
    const secret = readFileSync(TOTP_KEY_FILE, "utf-8").trim();
    if (secret && process.env.NODE_ENV !== "test" && !process.argv.includes("--quiet") && !process.argv.includes("-q")) {
        console.log(`[ShellPort] 🔑 Loaded TOTP secret from ${TOTP_KEY_FILE}`);
    }
    return secret;
}

/**
 * Delete the persisted TOTP secret (for --totp-reset).
 */
export function deleteTOTPSecret(): void {
    if (existsSync(TOTP_KEY_FILE)) {
        unlinkSync(TOTP_KEY_FILE);
    }
}
