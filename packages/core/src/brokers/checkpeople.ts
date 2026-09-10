import type { Page } from "playwright";
import type { PiiProfile } from "../pii.js";
import type { BrokerAdapter, RemovalResult } from "./types.js";
import type { SearchCandidate } from "./matching.js";
import { hasAntiBotMarkerOnPage } from "./detection.js";

/**
 * CheckPeople does not expose a way to distinguish "match" from
 * "no match" without going past a paywall.
 *
 * WHY THIS EXISTS (real bug found and reverted, 2026-09-10): the initial
 * Round 11 implementation used the `#modifySearchModal` "No results
 * found" text as the no-match signal. That was WRONG. Direct comparison
 * confirmed the `#modifySearchModal` markup, the "We found 10+ Results"
 * headline, and the entire `/results` page shell are **byte-for-byte
 * identical** for a synthetic no-match identity ("Zaphod Beeblebrox")
 * and a real common name ("John Smith") -- diffed directly, 0
 * structural differences beyond the name itself. The modal is a static
 * "refine your search" UI element present unconditionally, not a
 * match-count signal.
 *
 * Following that page's own client-side JS: it forces a redirect after
 * ~4 seconds to `/open-report/step1-opening`, which leads into a paid
 * report/checkout funnel (`credit`, `checkout` markup observed). No
 * genuine free-tier match/no-match signal was found short of that
 * paywall, and this project does not simulate a purchase to probe
 * further.
 *
 * This function is therefore permanently unable to return a reliable
 * verdict from the `/results` HTML alone and always returns false
 * (never claims "no match" from data that can't support that claim).
 * search() below does not call this to gate anything -- it fails closed
 * to [] unconditionally, same as before Round 11, but now for the
 * correct, verified reason.
 */
export function checkPeopleHasNoMatch(_html: string): boolean {
  return false;
}

/**
 * CheckPeople adapter.
 *
 * REACHABILITY (re-verified live 2026-09-10, superseding the 2026-09-09
 * "IP-banned" finding below): a full synthetic search flow (homepage ->
 * scrape Laravel CSRF _token -> POST /landing -> GET .../results, skipping
 * the transient .../searching redirect hop) completed cleanly via plain
 * HTTP requests with zero anti-bot challenges, reproduced independently
 * three times on 2026-09-10 (once with a synthetic identity, once with a
 * real common name "John Smith"). See docs/checkpeople-reachability.md
 * for the full endpoint spec and captured cookies.
 *
 * HOWEVER, the posture is genuinely inconsistent, not simply "now open":
 * an independent re-check roughly an hour later hit a Cloudflare
 * "Under Attack Mode"-style JS-challenge redirect on the same homepage.
 * search() below re-probes live on every call rather than assuming either
 * extreme — it does not cache or hard-code a reachability verdict.
 *
 * Earlier finding (2026-09-09, now known to be non-representative of a
 * fixed state): the public search URL https://checkpeople.com/ was not
 * reachable from this runtime at that time — direct HTTP requests
 * returned HTTP 403, and the rendered page reported "Verifying Protocol
 * For Anonymous Access..." rather than exposing a usable search/result
 * flow. The previously inspected opt-out URL was separately blocked by
 * the same anti-bot boundary at that time.
 *
 * NO USABLE MATCH SIGNAL EXISTS ON THE FREE-TIER RESULTS PAGE (found and
 * corrected 2026-09-10 — see checkPeopleHasNoMatch's docstring for the
 * full comparison). The `/results` page CheckPeople returns is a generic
 * pre-loader/paywall-teaser shell, byte-for-byte identical in structure
 * whether the query has zero real matches or many. It forces a client-side
 * JS redirect into a paid report/checkout funnel after ~4 seconds; this
 * project does not simulate a purchase to see past that gate. Given that,
 * search() below cannot honestly return either a positive match or a
 * confirmed no-match from this broker today — it always returns [],
 * documented as a known free-tier limitation rather than a solved
 * reachability problem.
 *
 * search() still performs the real navigation (GET homepage for a fresh
 * CSRF token/cookies, POST /landing with the synthetic query, GET the
 * results page from the redirect's searchId, skipping the transient
 * "searching" hop) so that reachability continues to be re-verified live
 * on every call, and so this adapter is ready to return real candidates
 * the moment a genuine free-tier match signal is found (e.g. if
 * CheckPeople's product changes, or a different endpoint is discovered).
 */
export class CheckPeopleAdapter implements BrokerAdapter {
  readonly brokerId = "checkpeople";
  readonly brokerName = "CheckPeople";
  readonly method = "form" as const;
  readonly searchUrl = "https://checkpeople.com/";
  readonly optOutUrl = "https://checkpeople.com/opt-out";
  readonly searchFields = ["firstName", "lastName", "addresses"] as const;
  readonly requiredFields = ["emails", "firstName", "lastName", "addresses"] as const;

  async search(_page: Page, minimalProfile: Partial<PiiProfile>): Promise<SearchCandidate[]> {
    const firstName = minimalProfile.firstName?.trim();
    const lastName = minimalProfile.lastName?.trim();
    if (!firstName || !lastName) return [];

    const city = minimalProfile.addresses?.[0]?.city;

    try {
      // Step 1: GET homepage for a fresh per-session CSRF token + cookies.
      const homeRes = await fetch(this.searchUrl, {
        headers: { "User-Agent": USER_AGENT },
      });
      if (!homeRes.ok) return [];
      const cookies = extractSetCookies(homeRes);
      const homeHtml = await homeRes.text();
      const token = extractCsrfToken(homeHtml);
      if (!token || !cookies) return [];

      // Step 2: POST the synthetic-minimal search. Only name (+ city, if
      // known) is sent — never more of the profile than the broker's own
      // search form requires.
      const body = new URLSearchParams({
        _token: token,
        aid: "11",
        firstName,
        lastName,
        ...(city ? { city } : {}),
      });
      const landingRes = await fetch("https://checkpeople.com/landing", {
        method: "POST",
        redirect: "manual",
        headers: {
          "User-Agent": USER_AGENT,
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: this.searchUrl,
          Cookie: cookies,
        },
        body: body.toString(),
      });
      const location = landingRes.headers.get("location");
      if (!location) return [];

      // Step 3: the Location header's searchId is valid for the results
      // page directly — skip the transient "searching" redirect hop
      // (verified live: it 302s again with no content of its own).
      const resultsUrl = location.replace("/searching", "/results");
      await fetch(resultsUrl, {
        headers: { "User-Agent": USER_AGENT, Cookie: cookies },
      });
      // The navigation succeeding (or not) only confirms reachability;
      // the response body carries no reliable match/no-match signal (see
      // class docstring and checkPeopleHasNoMatch) — fail closed either
      // way rather than guessing at candidate rows.
      return [];
    } catch {
      return [];
    }
  }

  async optOut(page: Page, profile: Partial<PiiProfile>): Promise<RemovalResult> {
    const timestamp = new Date().toISOString();
    const email = profile.emails?.[0];
    if (!email) return this.fail(timestamp, "Missing required email");

    await page.goto(this.optOutUrl, { waitUntil: "domcontentloaded" });

    if (await hasAntiBotMarkerOnPage(page)) {
      return {
        broker: this.brokerId,
        status: "requires_manual_verification",
        timestamp,
        evidence: {
          reason: "Interactive anti-bot challenge detected; automation does not bypass CAPTCHA/Turnstile",
        },
      };
    }

    return this.fail(
      timestamp,
      "CheckPeople opt-out form structure could not be live-verified; refusing to guess selectors or submit",
    );
  }

  private fail(timestamp: string, error: string): RemovalResult {
    return {
      broker: this.brokerId,
      status: "failed",
      timestamp,
      evidence: { dryRun: true },
      error,
    };
  }
}

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

function extractCsrfToken(html: string): string | undefined {
  const match = html.match(/name=_token value="([^"]+)"/);
  return match?.[1];
}

function extractSetCookies(res: Response): string | undefined {
  const raw = res.headers.get("set-cookie");
  if (!raw) return undefined;
  // Only the name=value pairs are needed for the next request; drop
  // attributes (Expires, Path, HttpOnly, etc).
  return raw
    .split(/,(?=[^;]+?=)/)
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}
