import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import {
  PiiProfileSchema,
  runRemoval,
  runScheduledChecks,
  readAllowPaywallBypassFromEnv,
  JsonlRunLogger,
  getBrokerAdapter,
  listBrokerIds,
  addPerson,
  editPerson,
  listPeople,
  linkPeople,
  type PiiProfile,
  type PersonRecord,
} from "@optoutos/core";
import { parseArgs, type StoreSelector } from "./args.js";
import { resolveStore } from "./store-factory.js";

const HELP_TEXT = `
OptOutOS CLI — local-first data-broker removal, run entirely on your machine.

Usage:
  optoutos list-brokers
  optoutos run --broker <brokerId> --profile <path-to-profile.json> [--execute]
  optoutos run --broker <brokerId> --person <personId> --store <path> [--execute]
  optoutos person add --store <path> --first <name> --last <name> [--email ...] [--phone ...] [--street --city --state --zip] [--dob YYYY-MM-DD] [--notes ...]
  optoutos person edit --store <path> --id <personId> [same optional fields as add]
  optoutos person list --store <path>
  optoutos person link --store <path> --a <personId> --b <personId> --type <spouse|parent|child|sibling|other>
  optoutos schedule-run --store <path> [--broker <id> ...] [--execute]

Commands:
  list-brokers            List all supported broker ids.
  run                     Search a broker and, if a confident match is
                           found, attempt removal. DRY-RUN by default —
                           pass --execute to actually submit (adapters may
                           still refuse if the broker requires manual
                           verification, e.g. an active CAPTCHA/Turnstile
                           challenge; this project never bypasses those).
  person add/edit/list/link
                           Manage a persistent, encrypted, multi-person
                           household store. See docs/PEOPLE_STORE.md.
  schedule-run            Run every PERSON x BROKER pair whose re-check
                           interval has elapsed (see docs/SCHEDULING.md for
                           the recommended cadence and setup as an OS
                           cron/Task Scheduler job). Brokers already checked
                           recently are skipped automatically — safe to
                           invoke daily. DRY-RUN by default, same --execute
                           gate as 'run'. Writes a non-PII JSONL audit log
                           next to the store (see docs/SCHEDULING.md).

Options for 'run':
  --broker <id>           Required. Run 'list-brokers' to see valid ids.
  --profile <path>        Path to a JSON file matching the PiiProfile
                           schema. Mutually exclusive with --person.
  --person <id> --store <path>
                           Load this person from a household store instead
                           of a standalone profile file. Mutually exclusive
                           with --profile. See 'person list' to find ids.
  --execute               Without this flag, adapters run in dry-run mode
                           and never submit a real request.

Options for 'schedule-run':
  --store / --store-bws   Required. The household to check (all people in
                           it, unless --person support is added later).
  --broker <id>           Optional, repeatable. Restrict to specific
                           brokers instead of every registered broker.
  --execute               Same meaning as 'run' — omit for a safe dry-run.

Store selectors (shared by 'run --person' and all 'person' subcommands):
  --store <path>          A local, passphrase-encrypted file store.
                           Passphrase comes from OPTOUTOS_PASSPHRASE — never
                           pass it as a flag (shell history / ps exposure).
  --store-bws <secretId>  A Bitwarden Secrets Manager-backed store. Token
                           comes from BWS_ACCESS_TOKEN (existing convention).

Privacy note: this CLI never phones home, logs no PII, and only contacts
the broker you explicitly target. See THREAT_MODEL.md, SECURITY.md, and
docs/PEOPLE_STORE.md.
`.trim();

async function loadProfileFromFile(path: string): Promise<PiiProfile> {
  const raw = await readFile(path, "utf-8");
  return PiiProfileSchema.parse(JSON.parse(raw));
}

/** Household-matching.ts uses the same shape; kept in sync deliberately. */
function personToPiiProfile(person: PersonRecord): PiiProfile {
  return {
    firstName: person.firstName,
    lastName: person.lastName,
    middleName: person.middleName,
    dateOfBirth: person.dateOfBirth,
    emails: person.emails,
    phones: person.phones,
    addresses: person.addresses,
    relatives: [],
  };
}

function describeStore(store: StoreSelector): string {
  return store.kind === "local-file" ? `local file (${store.path})` : `BWS secret (${store.secretId})`;
}

/**
 * Where schedule-run's non-PII JSONL audit log lives for a given store.
 * For a local-file store, it's a sibling file next to the encrypted
 * household file (e.g. household.enc.json -> household.enc.json.runs.jsonl)
 * — easy to find, and clearly associated with that one household. For a
 * BWS-backed store, there is no local file to anchor it to, so it goes
 * under a fixed per-secret path in the OS-appropriate config/cache
 * directory instead — still one log file per household (keyed by secret
 * id), never a single shared log across unrelated households, matching the
 * store's own physical-isolation principle (see people/types.ts).
 */
function runLogPathFor(store: StoreSelector): string {
  if (store.kind === "local-file") {
    return `${store.path}.runs.jsonl`;
  }
  const safeId = store.secretId.replace(/[^a-zA-Z0-9-]/g, "_");
  return join(homedir(), ".optoutos", `${safeId}.runs.jsonl`);
}

export async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    console.error("\nRun 'optoutos' with no arguments for usage.");
    return 1;
  }

  if (parsed.command === "help") {
    console.log(HELP_TEXT);
    return 0;
  }

  if (parsed.command === "list-brokers") {
    for (const id of listBrokerIds()) {
      console.log(id);
    }
    return 0;
  }

  if (parsed.command === "person-add") {
    try {
      const store = resolveStore(parsed.store);
      const created = await addPerson(store, parsed.fields);
      console.log(`Added ${created.firstName} ${created.lastName} (id: ${created.id}) to ${describeStore(parsed.store)}`);
      return 0;
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
  }

  if (parsed.command === "person-edit") {
    try {
      const store = resolveStore(parsed.store);
      const updated = await editPerson(store, parsed.id, parsed.fields);
      console.log(`Updated ${updated.firstName} ${updated.lastName} (id: ${updated.id})`);
      return 0;
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
  }

  if (parsed.command === "person-list") {
    try {
      const store = resolveStore(parsed.store);
      const people = await listPeople(store);
      if (people.length === 0) {
        console.log(`No people in ${describeStore(parsed.store)} yet.`);
        return 0;
      }
      for (const p of people) {
        console.log(`${p.id}  ${p.firstName} ${p.lastName}`);
      }
      return 0;
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
  }

  if (parsed.command === "person-link") {
    try {
      const store = resolveStore(parsed.store);
      await linkPeople(store, parsed.personA, parsed.personB, parsed.relationshipType);
      console.log(`Linked ${parsed.personA} <-> ${parsed.personB} as "${parsed.relationshipType}"`);
      return 0;
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
  }

  if (parsed.command === "schedule-run") {
    try {
      const store = resolveStore(parsed.store);
      const brokerIds = parsed.brokers ?? listBrokerIds();
      const adapters = brokerIds.map((id) => {
        const adapter = getBrokerAdapter(id);
        if (!adapter) throw new Error(`Unknown broker id: ${id}`);
        return adapter;
      });

      if (!parsed.execute) {
        console.log(
          `[dry-run] Note: --execute was not passed. Due brokers will be searched (read-only); no removal requests will be sent — pass --execute to actually submit.`,
        );
      }

      const allowPaywallBypass = readAllowPaywallBypassFromEnv();
      if (allowPaywallBypass) {
        console.log(
          `[paywall-bypass] Note: OPTOUTOS_ALLOW_PAYWALL_BYPASS is set. Adapters with a verified free paywall-bypass path (most do not have one) may use it as a fallback.`,
        );
      }

      const logger = new JsonlRunLogger(runLogPathFor(parsed.store));
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        const summary = await runScheduledChecks({
          store,
          adapters,
          page,
          dryRun: !parsed.execute,
          allowPaywallBypass,
          logger,
        });
        console.log(
          `Scheduled run complete: ${summary.ranCount} checked, ${summary.skippedCount} not yet due, ${summary.errorCount} errored.`,
        );
        return summary.errorCount > 0 ? 1 : 0;
      } finally {
        await browser.close();
      }
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
  }

  // parsed.command === "run"
  const adapter = getBrokerAdapter(parsed.broker);
  if (!adapter) {
    console.error(`Unknown broker id: ${parsed.broker}`);
    console.error(`Run 'optoutos list-brokers' to see valid ids.`);
    return 1;
  }

  let profile: PiiProfile;
  try {
    if (parsed.source.kind === "profile-file") {
      profile = await loadProfileFromFile(parsed.source.path);
    } else {
      const source = parsed.source;
      const store = resolveStore(source.store);
      const household = await store.load();
      const person = household.people.find((p) => p.id === source.personId);
      if (!person) {
        console.error(`Person not found: ${source.personId}`);
        console.error(`Run 'optoutos person list --store ...' to see valid ids.`);
        return 1;
      }
      profile = personToPiiProfile(person);
    }
  } catch (err) {
    console.error(`Failed to load PII source: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  if (!parsed.execute) {
    console.log(
      `[dry-run] Note: --execute was not passed. search() runs (read-only); if a confirmed match is found, no removal request will be sent — pass --execute to actually submit.`,
    );
  }

  const allowPaywallBypass = readAllowPaywallBypassFromEnv();
  if (allowPaywallBypass) {
    console.log(
      `[paywall-bypass] Note: OPTOUTOS_ALLOW_PAYWALL_BYPASS is set. If this broker's adapter implements a genuine, verified free bypass of a payment paywall (most do not), it may be used as a fallback when the free search finds no match.`,
    );
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const result = await runRemoval(adapter, page, profile, {
      dryRun: !parsed.execute,
      allowPaywallBypass,
    });

    console.log(JSON.stringify(result, null, 2));
    return result.status === "failed" ? 1 : 0;
  } finally {
    await browser.close();
  }
}
