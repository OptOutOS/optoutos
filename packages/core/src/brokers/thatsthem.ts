import type { Page } from "playwright";
import type { BrokerAdapter, RemovalResult } from "./types.js";
import type { PiiProfile } from "../pii.js";

/**
 * That'sThem opt-out adapter.
 *
 * Verified against the live form at https://thatsthem.com/optout on
 * 2026-09-09 via manual DOM inspection (not guessed). Fields present:
 *   #name    (text, required)  — full name
 *   #street  (text, required)  — street address
 *   #city    (text, required)
 *   #state   (select, required)
 *   #zip     (text, required)
 *   #email   (email, required)
 *   #phone   (tel, required)
 * Submit button text: "Submit Opt-Out Request"
 *
 * ⚠ ANTI-BOT STATUS (verified 2026-09-09): This site serves a Cloudflare
 * Turnstile interactive "Confirm you're human" challenge to automated
 * browsers (confirmed via captured cf-turnstile widget markup), not just a
 * passive JS check. Per project policy ("anti-bot if easy, otherwise move
 * on" — no CAPTCHA-solving in this project), this adapter does NOT attempt
 * to bypass Turnstile. It fails closed with "requires_manual_verification"
 * whenever the challenge is detected. A real desktop-browser session (not
 * headless/stealth-patched) reached the actual form without a challenge,
 * suggesting the trigger is bot-fingerprinting rather than a universal gate
 * — worth re-testing periodically, but not worth building a solver for now.
 *
 * No search/lookup step is required before opting out — the form accepts a
 * direct removal request when reachable.
 *
 * Required fields are deliberately minimal: only what the form asks for.
 * That'sThem requires a single street address; if the profile has multiple
 * addresses, the first is used and the adapter should be re-run per address
 * if the user has lived at more than one place associated with their record.
 */
export class ThatsThemAdapter implements BrokerAdapter {
  readonly brokerId = "thatsthem";
  readonly brokerName = "That'sThem";
  readonly method = "form" as const;
  readonly searchUrl = "https://thatsthem.com/";
  readonly optOutUrl = "https://thatsthem.com/optout";
  readonly requiredFields = ["firstName", "lastName", "addresses", "emails", "phones"] as const;

  async optOut(page: Page, profile: Partial<PiiProfile>): Promise<RemovalResult> {
    const timestamp = new Date().toISOString();

    if (!profile.firstName || !profile.lastName) {
      return this.fail(timestamp, "Missing required name fields");
    }
    const address = profile.addresses?.[0];
    if (!address) {
      return this.fail(timestamp, "Missing required address");
    }
    const email = profile.emails?.[0];
    const phone = profile.phones?.[0];
    if (!email || !phone) {
      return this.fail(timestamp, "Missing required email or phone");
    }

    await page.goto(this.optOutUrl, { waitUntil: "domcontentloaded" });

    // Anti-bot policy: detect (don't attempt to bypass) an active Turnstile
    // challenge and fail closed for manual handling. See class docstring.
    const turnstileChallenge = page.locator(".cf-turnstile, #cf-turnstile, [class*='cf-chl-widget']");
    if (await turnstileChallenge.count()) {
      return {
        broker: this.brokerId,
        status: "requires_manual_verification",
        timestamp,
        evidence: {
          reason: "Cloudflare Turnstile challenge detected — automation intentionally does not attempt to bypass CAPTCHA/anti-bot widgets",
        },
      };
    }

    // Fail closed if the form structure has changed since verification.
    const nameField = page.locator("#name");
    if (!(await nameField.count())) {
      return this.fail(
        timestamp,
        "Form structure changed: #name field not found — adapter needs re-verification",
      );
    }

    const fullName = [profile.firstName, profile.middleName, profile.lastName]
      .filter(Boolean)
      .join(" ");

    await nameField.fill(fullName);
    await page.locator("#street").fill(address.street);
    await page.locator("#city").fill(address.city);
    await page.locator("#state").selectOption({ label: this.stateNameFromAbbrOrName(address.state) });
    await page.locator("#zip").fill(address.zip);
    await page.locator("#email").fill(email);
    await page.locator("#phone").fill(phone);

    // NOTE: intentionally not auto-clicking submit yet in this spike commit —
    // dry-run only, to avoid sending a real opt-out request with test/dummy
    // data during development. Flip `dryRun` to false only with real,
    // user-approved PII, sourced via a PiiSource (never hardcoded).
    const dryRun = true;
    if (dryRun) {
      return {
        broker: this.brokerId,
        status: "requires_manual_verification",
        timestamp,
        evidence: {
          dryRun: true,
          note: "Form filled but not submitted (dry-run spike mode)",
        },
      };
    }

    await page.locator("button:has-text('Submit Opt-Out Request')").click();
    await page.waitForLoadState("networkidle");

    return {
      broker: this.brokerId,
      status: "submitted",
      timestamp,
      evidence: {
        submittedUrl: page.url(),
      },
    };
  }

  private fail(timestamp: string, error: string): RemovalResult {
    return {
      broker: this.brokerId,
      status: "failed",
      timestamp,
      evidence: {},
      error,
    };
  }

  /** That'sThem's <select> uses full state names, not abbreviations. */
  private stateNameFromAbbrOrName(state: string): string {
    const abbrMap: Record<string, string> = {
      AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
      CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
      FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
      IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
      ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
      MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
      NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
      NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
      OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
      RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
      TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
      WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
    };
    return abbrMap[state.toUpperCase()] ?? state;
  }
}
