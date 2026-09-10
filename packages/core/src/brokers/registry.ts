import type { BrokerAdapter } from "./types.js";
import { ThatsThemAdapter } from "./thatsthem.js";
import { AdvancedBackgroundChecksAdapter } from "./advancedbackgroundchecks.js";
import { BeenVerifiedAdapter } from "./beenverified.js";
import { CheckPeopleAdapter } from "./checkpeople.js";
import { InfoTracerAdapter } from "./infotracer.js";
import { InteliusAdapter } from "./intelius.js";
import { PublicDataUsaAdapter } from "./publicdatausa.js";
import { RadarisAdapter } from "./radaris.js";
import { SpokeoAdapter } from "./spokeo.js";
import { UsPhonebookAdapter } from "./usphonebook.js";
import { WhitepagesAdapter } from "./whitepages.js";

/**
 * Central registry mapping brokerId -> a fresh adapter instance.
 *
 * Moved from apps/cli/src/registry.ts into packages/core (2026-09-10) so
 * both the CLI and the web GUI (apps/web, broker-status dashboard, issue
 * #14) share one registry instead of duplicating the broker list — same
 * reasoning as person-commands.ts's move earlier in this session.
 *
 * ClustrMaps is intentionally excluded — see docs/BROKER_STATUS.md: it is
 * DNS-sinkholed by common network-level ad/tracker blocklists (UniFi, Pi-hole
 * style filtering), making it untestable/unreachable on many networks. It
 * can be added back once a real adapter is verified against it on an
 * unfiltered network.
 */
function buildRegistry(): Map<string, () => BrokerAdapter> {
  const registry = new Map<string, () => BrokerAdapter>();
  registry.set("thatsthem", () => new ThatsThemAdapter());
  registry.set("advancedbackgroundchecks", () => new AdvancedBackgroundChecksAdapter());
  registry.set("beenverified", () => new BeenVerifiedAdapter());
  registry.set("checkpeople", () => new CheckPeopleAdapter());
  registry.set("infotracer", () => new InfoTracerAdapter());
  registry.set("intelius", () => new InteliusAdapter());
  registry.set("publicdatausa", () => new PublicDataUsaAdapter());
  registry.set("radaris", () => new RadarisAdapter());
  registry.set("spokeo", () => new SpokeoAdapter());
  registry.set("usphonebook", () => new UsPhonebookAdapter());
  registry.set("whitepages", () => new WhitepagesAdapter());
  return registry;
}

const registry = buildRegistry();

export function listBrokerIds(): string[] {
  return Array.from(registry.keys()).sort();
}

export function getBrokerAdapter(brokerId: string): BrokerAdapter | undefined {
  return registry.get(brokerId)?.();
}
