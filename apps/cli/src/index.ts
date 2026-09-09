import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { PiiProfileSchema, runRemoval, type PiiProfile } from "@optoutos/core";
import { parseArgs } from "./args.js";
import { getBrokerAdapter, listBrokerIds } from "./registry.js";

const HELP_TEXT = `
OptOutOS CLI — local-first data-broker removal, run entirely on your machine.

Usage:
  optoutos list-brokers
  optoutos run --broker <brokerId> --profile <path-to-profile.json> [--execute]

Commands:
  list-brokers            List all supported broker ids.
  run                     Search a broker and, if a confident match is
                           found, attempt removal. DRY-RUN by default —
                           pass --execute to actually submit (adapters may
                           still refuse if the broker requires manual
                           verification, e.g. an active CAPTCHA/Turnstile
                           challenge; this project never bypasses those).

Options for 'run':
  --broker <id>           Required. Run 'list-brokers' to see valid ids.
  --profile <path>        Required. Path to a JSON file matching the
                           PiiProfile schema (see packages/core/src/pii.ts).
                           Your PII is read from this local file only —
                           nothing is sent anywhere except the target
                           broker's own search/opt-out endpoints.
  --execute               Without this flag, adapters run in dry-run mode
                           and never submit a real request.

Privacy note: this CLI never phones home, logs no PII, and only contacts
the broker you explicitly target. See THREAT_MODEL.md and SECURITY.md.
`.trim();

async function loadProfile(path: string): Promise<PiiProfile> {
  const raw = await readFile(path, "utf-8");
  return PiiProfileSchema.parse(JSON.parse(raw));
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

  // parsed.command === "run"
  const adapter = getBrokerAdapter(parsed.broker);
  if (!adapter) {
    console.error(`Unknown broker id: ${parsed.broker}`);
    console.error(`Run 'optoutos list-brokers' to see valid ids.`);
    return 1;
  }

  let profile: PiiProfile;
  try {
    profile = await loadProfile(parsed.profilePath);
  } catch (err) {
    console.error(
      `Failed to load/validate profile at ${parsed.profilePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  }

  if (!parsed.execute) {
    console.log(
      `[dry-run] Note: --execute was not passed. search() runs (read-only); if a confirmed match is found, no removal request will be sent — pass --execute to actually submit.`,
    );
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const result = await runRemoval(adapter, page, profile, { dryRun: !parsed.execute });

    console.log(JSON.stringify(result, null, 2));
    return result.status === "failed" ? 1 : 0;
  } finally {
    await browser.close();
  }
}
