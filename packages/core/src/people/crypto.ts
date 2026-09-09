import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // AES-256
const IV_LENGTH = 12; // recommended for GCM
const SCRYPT_N = 16384; // scrypt CPU/memory cost parameter (2^14)

/**
 * Derives a 32-byte AES-256 key from a user passphrase and a stored salt,
 * using scrypt (memory-hard, resists GPU/ASIC brute force better than
 * PBKDF2). The same passphrase+salt always derives the same key — the salt
 * (not the passphrase) is what's persisted alongside the encrypted store.
 */
export async function deriveKeyFromPassphrase(passphrase: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(passphrase, salt, KEY_LENGTH, { N: SCRYPT_N }, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

export interface EncryptedEnvelope {
  /** AES-256-GCM ciphertext, base64-encoded. */
  ciphertext: string;
  /** Initialization vector, base64-encoded. */
  iv: string;
  /** GCM authentication tag, base64-encoded — detects any tampering. */
  authTag: string;
}

/**
 * Encrypts an arbitrary JSON-serializable value with AES-256-GCM under the
 * given key. A fresh random IV is generated per call — never reuse an IV
 * with the same key (this is why encrypting the same plaintext twice
 * produces different ciphertext).
 */
export function encryptJson(value: unknown, key: Buffer): EncryptedEnvelope {
  if (key.length !== KEY_LENGTH) {
    throw new Error(`Encryption key must be ${KEY_LENGTH} bytes, got ${key.length}`);
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf-8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

/**
 * Decrypts an envelope produced by encryptJson(). Throws (does not silently
 * return garbage) if the key is wrong or the ciphertext/authTag has been
 * tampered with — AES-GCM's authentication tag makes this a genuine
 * integrity check, not just a decode step.
 */
export function decryptJson<T = unknown>(envelope: EncryptedEnvelope, key: Buffer): T {
  if (key.length !== KEY_LENGTH) {
    throw new Error(`Decryption key must be ${KEY_LENGTH} bytes, got ${key.length}`);
  }

  const iv = Buffer.from(envelope.iv, "base64");
  const authTag = Buffer.from(envelope.authTag, "base64");
  const ciphertext = Buffer.from(envelope.ciphertext, "base64");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString("utf-8")) as T;
}
