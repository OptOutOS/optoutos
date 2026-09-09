import type { BrokerAdapter } from "@optoutos/core";
import {
  ThatsThemAdapter,
  AdvancedBackgroundChecksAdapter,
  BeenVerifiedAdapter,
  CheckPeopleAdapter,
  InfoTracerAdapter,
  InteliusAdapter,
  PublicDataUsaAdapter,
  RadarisAdapter,
  SpokeoAdapter,
  UsPhonebookAdapter,
  WhitepagesAdapter,
} from "@optoutos/core";

/**
 * Central registry mapping brokerId -> a fresh adapter instance.
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
