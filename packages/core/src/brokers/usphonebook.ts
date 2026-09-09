import type { Page } from "playwright";
import type { PiiProfile } from "../pii.js";
import type { BrokerAdapter, RemovalResult } from "./types.js";
import type { SearchCandidate } from "./matching.js";

/**
 * US Phone Book opt-out adapter.
 *
 * Verified against https://usphonebook.com/opt-out on 2026-09-09. The page
 * combines the initial record-removal request with the opt-out instructions:
 * the requester enters the subject's first name, optional middle name, last
 * name, and email, chooses whether they are the subject or an authorized
 * agent, accepts the certification, completes reCAPTCHA, and selects
 * "Begin Removal Process". US Phone Book then emails a link to a second form;
 * this page does not submit the final removal request directly.
 *
 * The live rendered page exposed these labels/text: "Subject First Name*",
 * "Subject Middle Name", "Subject Last Name*", "Subject Email*",
 * "Begin Removal Process", and "reCAPTCHA". The live page also displayed
 * "Recaptcha requires verification" and "This site is exceeding reCAPTCHA
 * Enterprise free quota". Because this is an active CAPTCHA gate, the
 * adapter fails closed with requires_manual_verification and never attempts
 * to solve or bypass it.
 *
 * No API or email endpoint was exposed by the verified page, so METHOD_PRIORITY
 * selects the web form. requiredFields contains only the subject identity and
 * email needed for the initial request; an agent flow would additionally need
 * agent fields supplied by a future explicit agent-profile API.
 *
 * SEARCH VERIFICATION (2026-09-09): The public home page is a distinct
 * reverse-phone search UI. Its live server-rendered form uses POST /search,
 * with hidden CSRF `_token`, `searchType`, and `searchTextField`; the visible
 * input is `#pfHeaderInput` (the hero form uses `#pfHeroInput`). The page
 * advertises Phone, Name, and Address tabs, but the verified HTML defaults to
 * Phone and the name/address controls are disabled until the tab is changed.
 * A direct live request to the bare domain was blocked with HTTP 403 by
 * Cloudflare in this environment, while the www home page returned HTTP 200
 * and exposed the form. Because the actual rendered search POST/result page
 * could not be reached without an interactive browser session, no result
 * selectors or candidate fields were personally verified. `search()` therefore
 * fails closed with an empty array and does not attempt the opt-out flow.
 * This is a search-specific access block; it is distinct from the reCAPTCHA
 * gate observed on /opt-out.
 *
 * Submission is intentionally dry-run only: after filling the observed
 * subject fields, it returns requires_manual_verification without clicking the
 * real request button or sending an email.
 */
export class UsPhonebookAdapter implements BrokerAdapter {
  readonly brokerId = "usphonebook";
  readonly brokerName = "US Phone Book";
  readonly method = "form" as const;
  readonly searchUrl = "https://usphonebook.com/opt-out";
  readonly optOutUrl = "https://usphonebook.com/opt-out";
  readonly requiredFields = ["firstName", "lastName", "emails"] as const;
  readonly searchFields = ["phones"] as const;

  /**
   * The verified public search is a reverse-phone lookup. The actual POST
   * search/result response was not reachable from the available live browser
   * session (the bare host returned Cloudflare HTTP 403), so returning any
   * candidate would violate the broker-owned-results requirement. Never call
   * optOut() or guess result selectors here; fail closed until the result page
   * is live-verified.
   */
  async search(_page: Page, _minimalProfile: Partial<PiiProfile>): Promise<SearchCandidate[]> {
    return [];
  }

  async optOut(page: Page, profile: Partial<PiiProfile>): Promise<RemovalResult> {
    const timestamp = new Date().toISOString();
    const email = profile.emails?.[0];

    if (!profile.firstName || !profile.lastName || !email) {
      return this.fail(timestamp, "Missing required first name, last name, or email");
    }

    await page.goto(this.optOutUrl, { waitUntil: "domcontentloaded" });

    // Fail closed on the CAPTCHA observed on the live page. Do not bypass it.
    const captcha = page.locator(
      ".g-recaptcha, [class*=\"g-recaptcha\"], iframe[src*=\"recaptcha\"], [id*=\"recaptcha\"]",
    );
    const renderedCaptchaText = page.getByText(/reCAPTCHA|Recaptcha requires verification|I'm not a robot/i);
    if ((await captcha.count()) > 0 || (await renderedCaptchaText.count()) > 0) {
      return {
        broker: this.brokerId,
        status: "requires_manual_verification",
        timestamp,
        evidence: {
          reason: "reCAPTCHA detected; automation does not attempt to bypass CAPTCHA",
        },
      };
    }

    // These labels were observed in the rendered live page. Fail closed if
    // the page no longer exposes the verified initial-request flow.
    const firstName = page.getByLabel(/Subject\s+First\s+Name/i);
    const lastName = page.getByLabel(/Subject\s+Last\s+Name/i);
    const subjectEmail = page.getByLabel(/Subject\s+Email/i);
    if ((await firstName.count()) === 0 || (await lastName.count()) === 0 || (await subjectEmail.count()) === 0) {
      return this.fail(timestamp, "Form structure changed: verified subject fields not found");
    }

    await firstName.fill(profile.firstName);
    await lastName.fill(profile.lastName);
    await subjectEmail.fill(email);

    // Dry-run only. The real button is deliberately never clicked.
    return {
      broker: this.brokerId,
      status: "requires_manual_verification",
      timestamp,
      evidence: {
        dryRun: true,
        note: "Initial request fields filled but not submitted; complete reCAPTCHA and the emailed second form manually",
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
}
