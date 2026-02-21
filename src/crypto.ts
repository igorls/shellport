/**
 * ShellPort - E2E Encryption Engine (AES-256-GCM)
 *
 * Provides key derivation, message packing (encrypt), and unpacking (decrypt).
 * Works identically on server (Bun) and client (browser) via WebCrypto API.
 *
 * Security Model (v2):
 * - Per-session salt derived from server_nonce || client_nonce || "shellport-v2"
 * - Prevents precomputation attacks against weak passwords
 * - Server sends nonce immediately on WebSocket open
 * - Client includes its nonce in the first message
 */

import type { DecodedFrame, FrameTypeValue } from "./types.js";

const PBKDF2_ITERATIONS = 100_000;
const NONCE_LENGTH = 16;
const SALT_PREFIX = "shellport-v2";

export const PROTOCOL_VERSION = 2;

/**
 * Generate a cryptographically random URL-safe secret.
 * Used as the default when no --secret is provided.
 * Default 16 bytes = 128 bits of entropy.
 */
export function generateSecret(bytes = 16): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  const b64 = btoa(String.fromCharCode(...raw))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return b64;
}

/**
 * Generate a random nonce for per-session salt derivation.
 */
export function generateNonce(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(NONCE_LENGTH));
}

/**
 * Derive per-session salt from server and client nonces.
 * Salt = SHA-256(server_nonce || client_nonce || SALT_PREFIX)
 */
export async function deriveSessionSalt(
  serverNonce: Uint8Array,
  clientNonce: Uint8Array
): Promise<Uint8Array> {
  const data = new Uint8Array(serverNonce.length + clientNonce.length + SALT_PREFIX.length);
  data.set(serverNonce, 0);
  data.set(clientNonce, serverNonce.length);
  data.set(new TextEncoder().encode(SALT_PREFIX), serverNonce.length + clientNonce.length);
  
  const hash = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hash);
}

/**
 * Derive an AES-256-GCM key from a plaintext secret using PBKDF2.
 * @param secret - The user-provided secret
 * @param sessionSalt - Optional per-session salt (from deriveSessionSalt)
 * Returns null if no secret is provided (plaintext mode).
 */
export async function deriveKey(
  secret: string,
  sessionSalt?: Uint8Array
): Promise<CryptoKey | null> {
  if (!secret) return null;

  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"]
  );

  const salt: BufferSource = sessionSalt ? sessionSalt.buffer as ArrayBuffer : enc.encode(SALT_PREFIX);

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
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
    // Use subarray (zero-copy view) instead of slice (copy)
    const iv = buf.subarray(0, 12);
    try {
      buf = new Uint8Array(
        await crypto.subtle.decrypt(
          { name: "AES-GCM", iv },
          key,
          buf.subarray(12)
        )
      );
    } catch {
      return null;
    }
  }

  if (buf.length < 1) return null;
  return { type: buf[0] as FrameTypeValue, payload: buf.subarray(1) };
}

/**
 * Returns the crypto engine as inline JavaScript for embedding in the browser frontend.
 * This string is injected into the HTML so the browser has its own copy of deriveKey/pack/unpack.
 */
export function getCryptoJS(): string {
  return `
// ShellPort Crypto Engine v${PROTOCOL_VERSION}
const NONCE_LENGTH = ${NONCE_LENGTH};
const SALT_PREFIX = "${SALT_PREFIX}";
const PBKDF2_ITERATIONS = ${PBKDF2_ITERATIONS};

function generateNonce() {
  return crypto.getRandomValues(new Uint8Array(NONCE_LENGTH));
}

async function deriveSessionSalt(serverNonce, clientNonce) {
  const data = new Uint8Array(serverNonce.length + clientNonce.length + SALT_PREFIX.length);
  data.set(serverNonce, 0);
  data.set(clientNonce, serverNonce.length);
  data.set(new TextEncoder().encode(SALT_PREFIX), serverNonce.length + clientNonce.length);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hash);
}

async function deriveKey(secret, sessionSalt) {
  if (!secret) return null;
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"]
  );
  const salt = sessionSalt || enc.encode(SALT_PREFIX);
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
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
    const iv = buf.subarray(0, 12);
    try {
      buf = new Uint8Array(await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        key,
        buf.subarray(12)
      ));
    } catch {
      return null;
    }
  }
  if (buf.length < 1) return null;
  return { type: buf[0], payload: buf.subarray(1) };
}

// Sequential async queue for ordered message handling
class SeqQueue {
  constructor() { this.p = Promise.resolve(); }
  add(fn) { this.p = this.p.then(fn).catch(console.error); }
}
`;
}
