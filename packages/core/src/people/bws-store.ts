import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { HouseholdSchema, type Household } from "./types.js";
import type { PeopleStore } from "./store.js";

const execFileAsync = promisify(execFile);

/**
 * Bitwarden Secrets Manager-backed household store. Recommended for
 * multi-device/production use — Bitwarden handles encryption at rest and
 * backup; the household JSON never touches this machine's disk, only
 * process memory.
 *
 * Reads BWS_ACCESS_TOKEN from the environment only (never persisted, never
 * logged) — same convention as BitwardenSecretsPiiSource in pii-sources/.
 */
export class BitwardenSecretsPeopleStore implements PeopleStore {
  readonly name = "bitwarden-secrets-manager";

  constructor(private readonly secretId: string) {}

  private requireToken(): void {
    if (!process.env.BWS_ACCESS_TOKEN) {
      throw new Error(
        "BWS_ACCESS_TOKEN is not set. Refusing to proceed without a credential source.",
      );
    }
  }

  async load(): Promise<Household> {
    this.requireToken();

    try {
      const { stdout } = await execFileAsync("bws", ["secret", "get", this.secretId, "--output", "json"]);
      const parsed = JSON.parse(stdout) as { value: string };
      return HouseholdSchema.parse(JSON.parse(parsed.value));
    } catch {
      // Secret doesn't exist yet (first run) or bws itself failed — start
      // from an empty household rather than surfacing a raw CLI error for
      // what is, in the common case, just "nothing saved yet".
      return HouseholdSchema.parse({});
    }
  }

  async save(household: Household): Promise<void> {
    // Validate BEFORE calling out to bws — never let malformed data reach
    // the secrets manager.
    const validated = HouseholdSchema.parse(household);
    this.requireToken();

    await execFileAsync("bws", ["secret", "edit", this.secretId, "--value", JSON.stringify(validated)]);
  }
}
