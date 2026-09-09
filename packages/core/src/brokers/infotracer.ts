import type { Page } from "playwright";
import type { PiiProfile } from "../pii.js";
import type { BrokerAdapter, RemovalResult } from "./types.js";

/**
 * InfoTracer opt-out adapter.
 *
 * DNS resolved infotracer.com on 2026-09-09 (addresses included
 * 3.170.103.91, 3.170.103.81, 3.170.103.76, and 3.170.103.13).
 * The live opt-out URL redirected to https://infotracer.com/optout/ and was
 * inspected on 2026-09-09. It did not expose an opt-out form: the rendered
 * page displayed "Are you human?" and "You are accessing a page that needs
 * extra human verification ...". The HTML contained the observed form
 * #are-you, pointer-event verification script, and generated hidden fields
 * named _csrf-frontend, bot-token-0, and other bot-token-* fields.
 *
 * This is a direct opt-out URL, but the actual removal form cannot be
 * inspected until the site's interactive human-verification gate is passed.
 * No public opt-out API was found on the inspected site pages. Therefore the
 * adapter uses the form method and fails closed with
 * "requires_manual_verification" when the observed gate is present. It never
 * attempts to bypass or solve the challenge, and it does not submit anything.
 *
 * Selectors asserted here are only the challenge markers observed live:
 * #are-you, [name="_csrf-frontend"], and [name^="bot-token-"]. No removal
 * form selectors are inferred or claimed.
 */
export class InfoTracerAdapter implements BrokerAdapter {
  readonly brokerId = "infotracer";
  readonly brokerName = "InfoTracer";
  readonly method = "form" as const;
  readonly searchUrl = "https://infotracer.com/";
  readonly optOutUrl = "https://infotracer.com/optout";
  readonly requiredFields = [] as const;

  async optOut(page: Page, _profile: Partial<PiiProfile>): Promise<RemovalResult> {
    const timestamp = new Date().toISOString();
    await page.goto(this.optOutUrl, { waitUntil: "domcontentloaded" });

    const challengeForm = page.locator("#are-you");
    const csrfField = page.locator('[name="_csrf-frontend"]');
    const botTokenField = page.locator('[name^="bot-token-"]');
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const humanVerification = /are you human|extra human verification/i.test(bodyText);

    if ((await challengeForm.count()) > 0 && (await botTokenField.count()) > 0 || humanVerification) {
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
