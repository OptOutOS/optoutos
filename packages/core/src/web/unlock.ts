/**
 * Household-store unlock resolution for the web GUI.
 *
 * POLICY (user decision, 2026-09-10): BWS-backed unlock is the PRIMARY
 * path — consistent with the user's standing preference for
 * password-manager workflows over typing raw passphrases into a UI — with
 * an in-memory passphrase prompt as the FALLBACK for users without
 * Bitwarden Secrets Manager configured.
 *
 * This module is intentionally pure/framework-free (no HTTP, no
 * prompting): it only decides which unlock path is available given the
 * environment, and (for the fallback path) holds a passphrase safely for
 * the lifetime of a browser session. The web server layer is responsible
 * for actually opening a PeopleStore using whichever source this resolves
 * to, and for driving the prompt UI itself.
 */

export interface UnlockSourceEnv {
  BWS_ACCESS_TOKEN?: string;
  OPTOUTOS_BWS_SECRET_ID?: string;
}

export type UnlockSource =
  | { kind: "bws"; secretId: string }
  | { kind: "passphrase-prompt" };

/**
 * Resolves which unlock path the GUI should use, based on environment
 * configuration alone. Never reads/validates the actual token value beyond
 * "is it a non-empty string" — real credential validation happens where
 * BitwardenSecretsPeopleStore is actually used (bws-store.ts), not here.
 *
 * BWS is only chosen when BOTH a non-empty token AND a secret id are
 * present — a token alone (e.g. left set from an unrelated CLI session)
 * without a specific secret id to read from is not enough information to
 * safely default into BWS mode; falling back to the explicit prompt is
 * the fail-closed choice.
 */
export function resolveUnlockSource(env: UnlockSourceEnv = process.env): UnlockSource {
  const hasToken = !!env.BWS_ACCESS_TOKEN;
  const secretId = env.OPTOUTOS_BWS_SECRET_ID;

  if (hasToken && secretId) {
    return { kind: "bws", secretId };
  }
  return { kind: "passphrase-prompt" };
}

export interface InMemoryPassphraseSessionOptions {
  /** Auto-lock after this many ms of no activity. Defaults to 15 minutes. */
  idleTimeoutMs?: number;
}

const DEFAULT_IDLE_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Holds a household-store passphrase in process memory ONLY, for the
 * duration of a single unlocked GUI session. Never written to disk, never
 * logged (toString/JSON.stringify are overridden to redact it — see
 * tests), and auto-clears after an idle timeout so a passphrase does not
 * live in memory indefinitely if the user walks away from an open tab.
 *
 * This exists ONLY for the fallback (no-BWS) unlock path. The BWS path
 * never needs this — BitwardenSecretsPeopleStore re-reads BWS_ACCESS_TOKEN
 * from the environment per-call and never holds a raw household
 * passphrase at all.
 */
export class InMemoryPassphraseSession {
  #passphrase: string | undefined;
  #idleTimeoutMs: number;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: InMemoryPassphraseSessionOptions = {}) {
    this.#idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  }

  unlock(passphrase: string): void {
    this.#passphrase = passphrase;
    this.#resetTimer();
  }

  hasPassphrase(): boolean {
    return this.#passphrase !== undefined;
  }

  getPassphrase(): string {
    if (this.#passphrase === undefined) {
      throw new Error("Session is locked: no passphrase is currently held.");
    }
    this.#resetTimer();
    return this.#passphrase;
  }

  lock(): void {
    this.#passphrase = undefined;
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
  }

  #resetTimer(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.lock(), this.#idleTimeoutMs);
  }

  // Deliberately redact the passphrase from any accidental logging /
  // console.log(session) / JSON.stringify(session) call.
  toString(): string {
    return "[InMemoryPassphraseSession]";
  }

  toJSON(): unknown {
    return { locked: !this.hasPassphrase() };
  }
}
