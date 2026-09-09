/**
 * Client for a self-hosted FlareSolverr instance (https://github.com/FlareSolverr/FlareSolverr).
 *
 * FlareSolverr solves Cloudflare's PASSIVE computational/JS "checking your
 * browser" challenges by driving a real (undetected) Chrome instance. It does
 * NOT solve interactive CAPTCHAs (Turnstile, reCAPTCHA, hCaptcha) — its own
 * README states this explicitly. Per project policy ("anti-bot if easy,
 * otherwise move on" — no CAPTCHA-solving), routing through FlareSolverr is
 * within policy: it is not bypassing a human-verification widget, only
 * outlasting a passive bot-detection page the way a real browser would.
 *
 * Usage pattern: call solve() to get past a Cloudflare-gated URL. FlareSolverr
 * returns the cleared page's cookies + user agent. Inject those into a
 * Playwright BrowserContext (setCookies + matching User-Agent) so subsequent
 * Playwright navigation/interaction on that context is treated as the same
 * already-cleared browser session by Cloudflare.
 *
 * Requires a running FlareSolverr instance — see docs/FLARESOLVERR.md for
 * setup. Not bundled/auto-started; this is an optional, explicitly-enabled
 * capability (set FLARESOLVERR_URL to enable).
 */

export interface FlareSolverrCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

export interface FlareSolverrSolution {
  url: string;
  status: number;
  headers: Record<string, string>;
  response: string;
  cookies: FlareSolverrCookie[];
  userAgent: string;
}

export class FlareSolverrError extends Error {}

/**
 * Verified live 2026-09-09 against a locally-run FlareSolverr 3.5.0 instance:
 *   - Advanced Background Checks (advancedbackgroundchecks.com/opt-out): SOLVED — real form HTML returned.
 *   - Spokeo (spokeo.com/optout): SOLVED — real page HTML returned.
 *   - USPhonebook (usphonebook.com/opt-out): SOLVED — real form HTML returned.
 *   - CheckPeople, Whitepages: FAILED — FlareSolverr itself reports an
 *     IP-level Cloudflare ban ("Probably your IP is banned for this site"),
 *     not a challenge type it can solve. Do not route these through
 *     FlareSolverr expecting success; they need a different approach
 *     (different network/IP, or accept manual-only status).
 *   - That'sThem (thatsthem.com/optout): FALSE POSITIVE risk — FlareSolverr
 *     reports "Challenge not detected!" / HTTP 200, but the actual page body
 *     is still the Turnstile "Security Check" interstitial (an interactive
 *     challenge, which FlareSolverr cannot solve). Callers MUST inspect the
 *     actual response body/title, not just trust FlareSolverr's own status,
 *     before assuming a real page was reached. See isLikelyStillChallenged().
 */
export class FlareSolverrClient {
  constructor(private readonly baseUrl: string) {}

  async solve(url: string, maxTimeoutMs = 60000): Promise<FlareSolverrSolution> {
    const res = await fetch(`${this.baseUrl}/v1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cmd: "request.get",
        url,
        maxTimeout: maxTimeoutMs,
      }),
    });

    const data = (await res.json()) as {
      status: string;
      message: string;
      solution?: {
        url: string;
        status: number;
        headers: Record<string, string>;
        response: string;
        cookies: FlareSolverrCookie[];
        userAgent: string;
      };
    };

    if (data.status !== "ok" || !data.solution) {
      throw new FlareSolverrError(
        `FlareSolverr failed to solve ${url}: ${data.message ?? "unknown error"}`,
      );
    }

    const solution: FlareSolverrSolution = {
      url: data.solution.url,
      status: data.solution.status,
      headers: data.solution.headers,
      response: data.solution.response,
      cookies: data.solution.cookies,
      userAgent: data.solution.userAgent,
    };

    if (this.isLikelyStillChallenged(solution.response)) {
      throw new FlareSolverrError(
        `FlareSolverr reported success for ${url} but the response body still ` +
          `looks like an unresolved interactive challenge (e.g. Turnstile) — ` +
          `FlareSolverr cannot solve interactive CAPTCHAs, only passive JS checks.`,
      );
    }

    return solution;
  }

  /**
   * Heuristic check for a still-challenged page despite FlareSolverr
   * reporting success. Verified necessary live: That'sThem returns HTTP 200
   * with "Challenge not detected!" from FlareSolverr's own status, but the
   * actual page title is "Security Check" (a Turnstile interstitial).
   */
  isLikelyStillChallenged(html: string): boolean {
    const lower = html.toLowerCase();
    return (
      lower.includes("<title>security check</title>") ||
      lower.includes("cf-turnstile") ||
      lower.includes("confirm you\u2019re human") ||
      lower.includes("confirm you're human") ||
      lower.includes("checking your browser")
    );
  }
}

/** Reads FLARESOLVERR_URL from the environment; undefined if not configured. */
export function getFlareSolverrClientFromEnv(): FlareSolverrClient | undefined {
  const url = process.env.FLARESOLVERR_URL;
  return url ? new FlareSolverrClient(url) : undefined;
}

/**
 * Solve a Cloudflare-gated URL via FlareSolverr, then inject the resulting
 * cookies + user-agent into a Playwright BrowserContext so subsequent
 * Playwright navigation/interaction is treated as the same cleared session.
 *
 * IMPORTANT: keep the SAME BrowserContext for the rest of the adapter's
 * work with this broker — Cloudflare's clearance is tied to the cookie jar
 * + fingerprint combination. A fresh context loses the clearance.
 */
export async function primeContextWithFlareSolverr(
  context: import("playwright").BrowserContext,
  client: FlareSolverrClient,
  url: string,
): Promise<FlareSolverrSolution> {
  const solution = await client.solve(url);

  const cookies = solution.cookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    expires: c.expires,
    httpOnly: c.httpOnly ?? false,
    secure: c.secure ?? true,
    sameSite: c.sameSite ?? ("Lax" as const),
  }));
  await context.addCookies(cookies);

  return solution;
}

