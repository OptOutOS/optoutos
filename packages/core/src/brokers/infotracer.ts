import type { Page } from "playwright";
import type { PiiProfile } from "../pii.js";
import type { BrokerAdapter, RemovalResult } from "./types.js";
import type { SearchCandidate } from "./matching.js";

/**
 * InfoTracer opt-out adapter.
 *
 * Live verification on 2026-09-09:
 * - DNS resolved infotracer.com.
 * - The distinct public search page https://infotracer.com/ was reachable
 *   (HTTP 200) and visibly exposed a name form with the observed fields
 *   firstname, lastname, optional city, state, and a POST action under
 *   /loading/?ltid=home&mercSubId=home-name&type=name&searchTab=name.
 * - A dummy John Smith / Seattle, WA submission did not produce a verified
 *   public result listing in this runtime: the POST was rejected with HTTP
 *   400. Therefore no result-listing structure or candidate fields were
 *   observed, and search() fails closed with [].
 * - The opt-out URL separately displays InfoTracer's "Are you human?" gate
 *   with #are-you and bot-token-* fields; this adapter never bypasses it.
 *
 * The reachable search form is not sufficient to claim a match: only broker-
 * observed result records may be returned, so this adapter does not fabricate
 * candidates from the form or from the 400 response.
 */
export class InfoTracerAdapter implements BrokerAdapter {
  readonly brokerId = "infotracer";
  readonly brokerName = "InfoTracer";
  readonly method = "form" as const;
  readonly searchUrl = "https://infotracer.com/";
  readonly optOutUrl = "https://infotracer.com/optout";
  readonly searchFields = ["firstName", "lastName", "addresses"] as const;
  readonly requiredFields = [] as const;

  async search(_page: Page, _minimalProfile: Partial<PiiProfile>): Promise<SearchCandidate[]> {
    // HTTP 200 exposes the form, but the live dummy submission returned 400
    // before any result listing; fail closed rather than inventing a record.
    return [];
  }

  async optOut(page: Page, _profile: Partial<PiiProfile>): Promise<RemovalResult> {
    const timestamp = new Date().toISOString();
    await page.goto(this.optOutUrl, { waitUntil: "domcontentloaded" });

    const challengeForm = page.locator("#are-you");
    const csrfField = page.locator('[name="_csrf-frontend"]');
    const botTokenField = page.locator('[name^="bot-token-"]');
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const humanVerification = /are you human|extra human verification/i.test(bodyText);

    if (((await challengeForm.count()) > 0 && (await botTokenField.count()) > 0) || humanVerification) {
      return {
        broker: this.brokerId,
        status: "requires_manual_verification",
        timestamp,
        evidence: {
          reason: "InfoTracer interactive human-verification gate detected; automation does not bypass anti-bot checks",
          challengeFormObserved: (await challengeForm.count()) > 0,
          csrfFieldObserved: (await csrfField.count()) > 0,
          botTokenFieldObserved: (await botTokenField.count()) > 0,
        },
      };
    }

    return {
      broker: this.brokerId,
      status: "failed",
      timestamp,
      evidence: {},
      error: "Opt-out page structure changed: neither the verified human-verification gate nor a verified removal form was found",
    };
  }
}
