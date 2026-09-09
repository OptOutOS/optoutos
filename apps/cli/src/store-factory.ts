import { LocalEncryptedFileStore, BitwardenSecretsPeopleStore, type PeopleStore } from "@optoutos/core";
import type { StoreSelector } from "./args.js";

/**
 * Resolves a StoreSelector (chosen via --store/--store-bws flags, which
 * carry no secret material) into a live PeopleStore. Passphrase/token are
 * read from the environment only — never accepted as a CLI argument (see
 * args.ts docstring for why: shell history, `ps` visibility).
 */
export function resolveStore(selector: StoreSelector): PeopleStore {
  if (selector.kind === "local-file") {
    const passphrase = process.env.OPTOUTOS_PASSPHRASE;
    if (!passphrase) {
      throw new Error(
        "OPTOUTOS_PASSPHRASE is not set. Refusing to open a local encrypted store without a passphrase.",
      );
    }
    return new LocalEncryptedFileStore(selector.path, passphrase);
  }

  // selector.kind === "bws" — BitwardenSecretsPeopleStore checks
  // BWS_ACCESS_TOKEN itself at load()/save() time (existing convention).
  return new BitwardenSecretsPeopleStore(selector.secretId);
}
