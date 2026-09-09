import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { HouseholdSchema, type Household } from "./types.js";
import { encryptJson, decryptJson, deriveKeyFromPassphrase, type EncryptedEnvelope } from "./crypto.js";
import type { PeopleStore } from "./store.js";

const SALT_LENGTH = 16;

interface OnDiskFormat {
  /** Format/version marker for forward-compat migrations. */
  formatVersion: 1;
  /** Salt used to derive the AES key from the passphrase, base64. Not secret
   * on its own — scrypt's cost makes brute-forcing the passphrase from a
   * known salt expensive, not the salt's secrecy. */
  salt: string;
  envelope: EncryptedEnvelope;
}

/**
 * Local, passphrase-encrypted, single-file household store.
 *
 * Fully offline — no third-party dependency, no network call. The user owns
 * backup/rotation of both the file and the passphrase; there is no recovery
 * mechanism if the passphrase is lost (by design — a recoverable passphrase
 * is a weaker passphrase). See docs/PEOPLE_STORE.md for backup guidance.
 *
 * The file on disk is AES-256-GCM ciphertext plus a public salt/IV/auth tag
 * — never plaintext PII, verified in local-file-store.test.ts.
 */
export class LocalEncryptedFileStore implements PeopleStore {
  readonly name = "local-encrypted-file";

  constructor(
    private readonly filePath: string,
    private readonly passphrase: string,
  ) {}

  async load(): Promise<Household> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return HouseholdSchema.parse({});
      }
      throw err;
    }

    const onDisk = JSON.parse(raw) as OnDiskFormat;
    const salt = Buffer.from(onDisk.salt, "base64");
    const key = await deriveKeyFromPassphrase(this.passphrase, salt);
    const decrypted = decryptJson<unknown>(onDisk.envelope, key);
    return HouseholdSchema.parse(decrypted);
  }

  async save(household: Household): Promise<void> {
    // Validate BEFORE encrypting — never persist data that doesn't satisfy
    // the schema (including the relationship-referential-integrity checks
    // in HouseholdSchema.superRefine).
    const validated = HouseholdSchema.parse(household);

    const salt = randomBytes(SALT_LENGTH);
    const key = await deriveKeyFromPassphrase(this.passphrase, salt);
    const envelope = encryptJson(validated, key);

    const onDisk: OnDiskFormat = {
      formatVersion: 1,
      salt: salt.toString("base64"),
      envelope,
    };

    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(onDisk, null, 2), "utf-8");
  }
}
