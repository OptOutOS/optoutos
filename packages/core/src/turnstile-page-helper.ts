import type { Page } from "playwright";
import { TurnstileSolverClient, TurnstileSolveResult, extractTurnstileSitekey } from "./turnstile-solver.js";

/**
 * Detects a Cloudflare Turnstile widget on the current page, solves it via
 * the given solver client, and injects the resulting token into the page's
 * `cf-turnstile-response` hidden input — the standard field name Turnstile's
 * own client-side script writes into, which the surrounding form then
 * submits normally. Returns undefined (no-op) if no widget is present.
 *
 * Callers are responsible for handling TurnstileSolverError thrown here by
 * failing closed to `requires_manual_verification` — this helper does not
 * swallow errors, per project policy (never guess/fabricate on failure).
 */
export async function solveTurnstileOnPage(
  page: Page,
  client: TurnstileSolverClient,
  timeoutSeconds = 45,
): Promise<TurnstileSolveResult | undefined> {
  const html = await page.content();
  const sitekey = extractTurnstileSitekey(html);
  if (!sitekey) return undefined;

  const siteurl = page.url();
  const result = await client.solve(sitekey, siteurl, timeoutSeconds);

  await page.evaluate((token: string) => {
    let input = document.querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]');
    if (!input) {
      input = document.createElement("input");
      input.type = "hidden";
      input.name = "cf-turnstile-response";
      document.body.appendChild(input);
    }
    input.value = token;
  }, result.token);

  return result;
}
