/**
 * Client for a self-hosted Cloudflare Turnstile solver service, e.g.
 * EzSolver (https://github.com/ismoiloffS/EzSolver) or a compatible
 * alternative such as Theyka/Turnstile-Solver
 * (https://github.com/Theyka/Turnstile-Solver) exposing the same
 * `POST /solve {sitekey, siteurl, timeout}` -> `{token, elapsed}` shape.
 *
 * POLICY (see THREAT_MODEL.md "Anti-bot / CAPTCHA policy", revised
 * 2026-09-09): bypassing interactive CAPTCHA/Turnstile/reCAPTCHA challenges
 * is in scope ONLY via a real-browser, LOCALLY-RUN solver like this one —
 * never via a third-party PAID CAPTCHA-solving API (2Captcha, CapSolver,
 * Scrappey, etc.), which would send challenge/traffic data to an external
 * company. If no solver is configured (TURNSTILE_SOLVER_URL unset) or the
 * solver fails, callers MUST fail closed to `requires_manual_verification`
 * — never guess, fabricate, or retry indefinitely.
 *
 * This client is deliberately solver-agnostic (any service implementing the
 * same request/response shape works) rather than coupled to one project's
 * internals, since third-party solver projects can go unmaintained.
 */

export class TurnstileSolverError extends Error {}

export interface TurnstileSolveResult {
  token: string;
  elapsedSeconds: number;
}

export class TurnstileSolverClient {
  constructor(private readonly baseUrl: string) {}

  async solve(sitekey: string, siteurl: string, timeoutSeconds = 45): Promise<TurnstileSolveResult> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/solve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sitekey, siteurl, timeout: timeoutSeconds }),
      });
    } catch (err) {
      throw new TurnstileSolverError(
        `Could not reach Turnstile solver service at ${this.baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const data = (await res.json()) as { token?: string; elapsed?: number; error?: string };

    if (!res.ok || !data.token) {
      throw new TurnstileSolverError(
        `Turnstile solver service failed to solve ${siteurl}: ${data.error ?? "unknown error"}`,
      );
    }

    return { token: data.token, elapsedSeconds: data.elapsed ?? 0 };
  }
}

/** Reads TURNSTILE_SOLVER_URL from the environment; undefined if not configured. */
export function getTurnstileSolverClientFromEnv(): TurnstileSolverClient | undefined {
  const url = process.env.TURNSTILE_SOLVER_URL;
  return url ? new TurnstileSolverClient(url) : undefined;
}

/**
 * Extracts a Cloudflare Turnstile sitekey from a page's HTML, looking for
 * the `data-sitekey` attribute on a `.cf-turnstile` element (Turnstile's
 * documented embed pattern). Returns undefined if none is found — callers
 * must not fabricate a sitekey.
 */
export function extractTurnstileSitekey(html: string): string | undefined {
  const match = html.match(/data-sitekey=["']([^"']+)["']/i);
  return match?.[1];
}
