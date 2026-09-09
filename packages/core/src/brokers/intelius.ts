import type { Page } from "playwright";
import type { PiiProfile } from "../pii.js";
import type { BrokerAdapter, RemovalResult } from "./types.js";

/**
 * Intelius / PeopleConnect opt-out adapter.
 *
 * Verification performed 2026-09-09:
 * - DNS resolution succeeded for both intelius.com and
 *   suppression.peopleconnect.us (A and AAAA records were returned).
 * - A direct request to https://intelius.com/ returned Cloudflare's
 *   "Just a moment..." challenge page. The response contained the
 *   challenges.cloudflare.com challenge resources; no public search form
 *   selectors were asserted from that response.
 * - https://suppression.peopleconnect.us/login returned the PeopleConnect
 *   Suppression Center single-page application shell (title:
 *   "PeopleConnect - Suppression Center"). Its loaded application bundle
 *   defines a /login route and redirects protected routes to /login unless
 *   sessionStorage contains accessToken and refreshToken. The bundle also
 *   exposes a separate /registration-token route, but this is not an
 *   anonymously usable opt-out form and the adapter must not create an
 *   account or invent credentials.
 * - The suppression shell includes a Cloudflare client-side challenge
 *   script. No CAPTCHA solver or anti-bot bypass is attempted.
 *
 * Consequently this adapter is intentionally manual-only. There was no
 * verified anonymous opt-out form or public API to automate. A user with a
 * real PeopleConnect account must complete the suppression flow manually.
 * requiredFields is empty because this adapter does not submit PII or log in;
 * it only reports the verified account/login gate.
 */
export class InteliusAdapter implements BrokerAdapter {
  readonly brokerId = "intelius";
  readonly brokerName = "Intelius";
  readonly method = "form" as const;
  readonly searchUrl = "https://intelius.com/";
  readonly optOutUrl = "https://suppression.peopleconnect.us/login";
  readonly requiredFields = [] as const;

  async optOut(_page: Page, _profile: Partial<PiiProfile>): Promise<RemovalResult> {
    const timestamp = new Date().toISOString();

    return {
      broker: this.brokerId,
      status: "requires_manual_verification",
      timestamp,
      evidence: {
        reason:
          "PeopleConnect suppression flow is login-gated: a real account/session is required; no anonymous opt-out form or public API was verified, and account creation/login is intentionally not automated",
        loginUrl: this.optOutUrl,
        antiBot:
          "Cloudflare challenge resources were observed on Intelius and a Cloudflare client-side challenge script was present in the PeopleConnect suppression shell; bypass is not attempted",
      },
    };
  }
}
