import type { Page } from "playwright";
import type { PiiProfile } from "../pii.js";
import type { BrokerAdapter, RemovalResult } from "./types.js";

/**
 * PublicDataUSA opt-out adapter placeholder.
 *
 * DNS verification performed on 2026-09-09 with fresh queries against the
 * configured resolver (192.168.1.1) and Cloudflare DNS (1.1.1.1): both
 * returned SERVFAIL for publicdatausa.com and no address. Because the domain
 * could not be resolved, https://publicdatausa.com/remove.php was not opened,
 * its form was not inspected, and no selectors, fields, anti-bot behavior, or
 * submission method are asserted here. This adapter fails closed until the
 * domain becomes resolvable and the live opt-out flow is re-verified.
 *
 * No PII is required by this unreachable-domain placeholder. Once the domain
 * is verified, requiredFields and the implementation must be updated from the
 * actual live form or API rather than inferred.
 */
export class PublicDataUsaAdapter implements BrokerAdapter {
  readonly brokerId = "publicdatausa";
  readonly brokerName = "PublicDataUSA";
  readonly method = "form" as const;
  readonly searchUrl = "https://publicdatausa.com/";
  readonly optOutUrl = "https://publicdatausa.com/remove.php";
  readonly requiredFields = [] as const;

  async optOut(_page: Page, _profile: Partial<PiiProfile>): Promise<RemovalResult> {
    const timestamp = new Date().toISOString();
    return {
      broker: this.brokerId,
      status: "failed",
      timestamp,
      evidence: {
        dnsStatus: "DNS_BLOCKED",
      },
      error:
        "Domain unreachable: publicdatausa.com returned DNS SERVFAIL from both the local resolver and 1.1.1.1 on 2026-09-09; opt-out flow was not inspected.",
    };
  }
}
