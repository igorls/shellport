/**
 * ShellPort - E2E Encryption Engine (AES-256-GCM)
 *
 * Provides key derivation, message packing (encrypt), and unpacking (decrypt).
 * Works identically on server (Bun) and client (browser) via WebCrypto API.
 */

import type { DecodedFrame, FrameTypeValue } from "./types.js";

const SALT = "shellport-v1-salt";
const PBKDF2_ITERATIONS = 100_000;

/**
 * Generate a cryptographically random URL-safe secret.
 * Used as the default when no --secret is provided.
 */
export function generateSecret(bytes = 9): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  // Base64url encoding (no padding) — safe for URL fragments
  const b64 = btoa(String.fromCharCode(...raw))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return b64;
}

/**
 * Derive an AES-256-GCM key from a plaintext secret using PBKDF2.
 * Returns null if no secret is provided (plaintext mode).
 */
export async function deriveKey(secret: string): Promise<CryptoKey | null> {
  if (!secret) return null;

  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: enc.encode(SALT),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Pack a message frame: [iv(12)][ciphertext] or [type(1)][payload] if unencrypted.
 */
export async function pack(
  key: CryptoKey | null,
  type: FrameTypeValue,
  payload: Uint8Array
): Promise<Uint8Array> {
  const frame = new Uint8Array(1 + payload.length);
  frame[0] = type;
  frame.set(payload, 1);

  if (!key) return frame;

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    frame
  );

  const out = new Uint8Array(12 + ciphertext.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ciphertext), 12);
  return out;
}

/**
 * Unpack a message, decrypting if a key is provided.
 * Returns null on decryption failure or malformed data.
 */
export async function unpack(
  key: CryptoKey | null,
  data: ArrayBuffer
): Promise<DecodedFrame | null> {
  let buf = new Uint8Array(data);

  if (key) {
    if (buf.length < 29) return null;
    const iv = buf.slice(0, 12);
    try {
      buf = new Uint8Array(
        await crypto.subtle.decrypt(
          { name: "AES-GCM", iv },
          key,
          buf.slice(12)
        )
      );
    } catch {
      return null;
    }
  }

  if (buf.length < 1) return null;
  return { type: buf[0] as FrameTypeValue, payload: buf.slice(1) };
}

/**
 * Returns the crypto engine as inline JavaScript for embedding in the browser frontend.
 * This string is injected into the HTML so the browser has its own copy of deriveKey/pack/unpack.
 */
export function getCryptoJS(): string {
  return `
// Derive AES-256-GCM key from secret using PBKDF2
async function deriveKey(secret) {
  if (!secret) return null;
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: enc.encode("${SALT}"),
      iterations: ${PBKDF2_ITERATIONS},
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// Pack a message: [iv(12)][ciphertext] or [type(1)][payload] if unencrypted
async function pack(key, type, payload) {
  const frame = new Uint8Array(1 + payload.length);
  frame[0] = type;
  frame.set(payload, 1);
  if (!key) return frame;
  
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    frame
  );
  const out = new Uint8Array(12 + ciphertext.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ciphertext), 12);
  return out;
}

// Unpack a message, decrypting if key provided
async function unpack(key, data) {
  let buf = new Uint8Array(data);
  if (key) {
    if (buf.length < 29) return null;
    const iv = buf.slice(0, 12);
    try {
      buf = new Uint8Array(await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        key,
        buf.slice(12)
      ));
    } catch {
      return null;
    }
  }
  if (buf.length < 1) return null;
  return { type: buf[0], payload: buf.slice(1) };
}

// Sequential async queue for ordered message handling
class SeqQueue {
  constructor() { this.p = Promise.resolve(); }
  add(fn) { this.p = this.p.then(fn).catch(console.error); }
}
`;
}
