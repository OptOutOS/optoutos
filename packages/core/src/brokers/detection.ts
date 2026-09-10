import type { Page } from "playwright";

/**
 * Shared anti-bot / CAPTCHA detection helpers, consolidating logic that
 * used to be independently hand-rolled (with real observed drift) in
 * advancedbackgroundchecks.ts, beenverified.ts, checkpeople.ts, spokeo.ts,
 * thatsthem.ts, usphonebook.ts, and whitepages.ts.
 *
 * Part of the "adapter-authoring kit" (docs/ADAPTER_GUIDE.md) — the goal is
 * that a new adapter gets the full, currently-known anti-bot marker set for
 * free, and a marker discovered while building one broker automatically
 * benefits every other adapter that uses this helper instead of
 * reimplementing detection locally.
 *
 * POLICY (see THREAT_MODEL.md "Anti-bot / CAPTCHA policy"): detecting these
 * markers is only ever used to fail closed to
 * "requires_manual_verification" (or, for Turnstile specifically, to hand
 * off to a real-browser locally-run solver — see turnstile-solver.ts). This
 * module never attempts to solve or defeat anything itself.
 */

/**
 * CSS selector covering every anti-bot widget marker observed live across
 * this project's adapters to date. Extend this list (not a copy of it in a
 * new adapter file) when a new marker is found on a broker.
 */
export const ANTI_BOT_CSS_SELECTOR =
  ".cf-turnstile, #cf-turnstile, [class*='cf-chl-widget'], .g-recaptcha, [class*='recaptcha'], [id*='recaptcha'], iframe[src*='recaptcha'], .h-captcha, [data-sitekey*='hcaptcha'], [data-sitekey], iframe[src*='challenges.cloudflare.com']";

/**
 * Text-level markers for cases where the CSS selector can't find a widget
 * (e.g. a client-rendered app shell that only mentions the provider in a
 * <script> bundle or in plain body text, or a Cloudflare block/interstitial
 * page that has no widget at all, just a block message).
 */
const ANTI_BOT_TEXT_PATTERN =
  /cf-turnstile|cf-chl-widget|challenges\.cloudflare\.com|turnstile|g-recaptcha|recaptcha|h-captcha|hcaptcha|data-sitekey|attention required!\s*\|\s*cloudflare|sorry, you have been blocked|unable to access .+\.com/i;

/**
 * Detects any known anti-bot marker in a raw HTML string (no live Page
 * needed) — useful when an adapter parses a FlareSolverr response or other
 * raw-fetched HTML directly rather than driving a live Playwright page (see
 * advancedbackgroundchecks.ts for that pattern).
 *
 * Fails closed: malformed/empty input returns false rather than throwing,
 * since the caller's own next check (e.g. verified form selectors) will
 * itself fail closed if the page isn't what was expected.
 */
export function detectAntiBotInHtml(html: string): boolean {
  if (!html) return false;
  return ANTI_BOT_TEXT_PATTERN.test(html);
}

/**
 * Detects any known anti-bot marker on a live Playwright Page: checks the
 * CSS selector first (covers rendered DOM widgets), then falls back to a
 * text-level check of the raw HTML (covers markers only present in
 * <script> bundles or challenge/block pages with no widget markup at all).
 *
 * This is the function most adapters should call from search()/optOut()
 * after page.goto() — see docs/ADAPTER_GUIDE.md for the full pattern.
 */
export async function hasAntiBotMarkerOnPage(page: Page): Promise<boolean> {
  const locatorCount = await page.locator(ANTI_BOT_CSS_SELECTOR).count();
  if (locatorCount > 0) return true;

  const html = await page.content();
  return detectAntiBotInHtml(html);
}
