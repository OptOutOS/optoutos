import type { PiiProfile } from "../pii.js";

/**
 * Pluggable source of the user's PII. Never hardcode PII; always source it
 * through one of these at runtime. See THREAT_MODEL.md — PII must not persist
 * in plaintext files by default.
 */
export interface PiiSource {
  readonly name: string;
  load(): Promise<PiiProfile>;
}

/**
 * Local file source — convenience for development/testing only.
 * Not recommended for real use; prefer BitwardenSecretsPiiSource or
 * an equivalent password-manager-backed source in production.
 */
export class LocalFilePiiSource implements PiiSource {
  readonly name = "local-file";
  constructor(private readonly filePath: string) {}

  async load(): Promise<PiiProfile> {
    const { readFile } = await import("node:fs/promises");
    const { PiiProfileSchema } = await import("../pii.js");
    const raw = await readFile(this.filePath, "utf-8");
    return PiiProfileSchema.parse(JSON.parse(raw));
  }
}

/**
 * Bitwarden Secrets Manager source — recommended for production use.
 * Reads BWS_ACCESS_TOKEN from the environment (never persisted to disk) and
 * fetches a JSON-encoded PiiProfile secret at runtime via the `bws` CLI or
 * SDK. PII never touches the OptOutOS filesystem beyond process memory.
 */
export class BitwardenSecretsPiiSource implements PiiSource {
  readonly name = "bitwarden-secrets-manager";
  constructor(private readonly secretId: string) {}

  async load(): Promise<PiiProfile> {
    const token = process.env.BWS_ACCESS_TOKEN;
    if (!token) {
      throw new Error(
        "BWS_ACCESS_TOKEN is not set. Refusing to proceed without a credential source.",
      );
    }
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync("bws", [
      "secret",
      "get",
      this.secretId,
      "--output",
      "json",
    ]);
    const { PiiProfileSchema } = await import("../pii.js");
    const parsed = JSON.parse(stdout) as { value: string };
    return PiiProfileSchema.parse(JSON.parse(parsed.value));
  }
}
