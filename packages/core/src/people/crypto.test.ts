import { describe, it, expect } from "vitest";
import { encryptJson, decryptJson, deriveKeyFromPassphrase } from "./crypto.js";

describe("deriveKeyFromPassphrase", () => {
  it("derives a 32-byte key deterministically from the same passphrase and salt", async () => {
    const salt = Buffer.from("0123456789abcdef0123456789abcdef", "hex");
    const key1 = await deriveKeyFromPassphrase("correct horse battery staple", salt);
    const key2 = await deriveKeyFromPassphrase("correct horse battery staple", salt);

    expect(key1.length).toBe(32);
    expect(key1.equals(key2)).toBe(true);
  });

  it("derives a different key for a different passphrase (same salt)", async () => {
    const salt = Buffer.from("0123456789abcdef0123456789abcdef", "hex");
    const key1 = await deriveKeyFromPassphrase("passphrase one", salt);
    const key2 = await deriveKeyFromPassphrase("passphrase two", salt);

    expect(key1.equals(key2)).toBe(false);
  });

  it("derives a different key for a different salt (same passphrase)", async () => {
    const salt1 = Buffer.from("0123456789abcdef0123456789abcdef", "hex");
    const salt2 = Buffer.from("fedcba9876543210fedcba9876543210", "hex");
    const key1 = await deriveKeyFromPassphrase("same passphrase", salt1);
    const key2 = await deriveKeyFromPassphrase("same passphrase", salt2);

    expect(key1.equals(key2)).toBe(false);
  });
});

describe("encryptJson / decryptJson", () => {
  const key = Buffer.alloc(32, 7); // deterministic test key, not derived from a real passphrase

  it("round-trips an object through encrypt then decrypt", async () => {
    const original = { firstName: "John", lastName: "Smith", nested: { a: [1, 2, 3] } };

    const envelope = encryptJson(original, key);
    const decrypted = decryptJson(envelope, key);

    expect(decrypted).toEqual(original);
  });

  it("produces ciphertext that does not contain the plaintext firstName as a substring", async () => {
    const original = { firstName: "UNMISTAKABLE_PLAINTEXT_MARKER", lastName: "Smith" };

    const envelope = encryptJson(original, key);

    expect(envelope.ciphertext).not.toContain("UNMISTAKABLE_PLAINTEXT_MARKER");
  });

  it("produces a different ciphertext each time (random IV) even for the same input", async () => {
    const original = { firstName: "John", lastName: "Smith" };

    const envelope1 = encryptJson(original, key);
    const envelope2 = encryptJson(original, key);

    expect(envelope1.ciphertext).not.toBe(envelope2.ciphertext);
    expect(envelope1.iv).not.toBe(envelope2.iv);
  });

  it("throws when decrypting with the wrong key (authentication failure, not silent corruption)", async () => {
    const wrongKey = Buffer.alloc(32, 9);
    const original = { firstName: "John", lastName: "Smith" };
    const envelope = encryptJson(original, key);

    expect(() => decryptJson(envelope, wrongKey)).toThrow();
  });

  it("throws when the ciphertext has been tampered with (auth tag mismatch)", async () => {
    const original = { firstName: "John", lastName: "Smith" };
    const envelope = encryptJson(original, key);
    const tampered = { ...envelope, ciphertext: envelope.ciphertext.slice(0, -4) + "abcd" };

    expect(() => decryptJson(tampered, key)).toThrow();
  });
});
