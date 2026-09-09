import { describe, it, expect } from "vitest";
import { FlareSolverrClient } from "./flaresolverr.js";

/**
 * Regression test for the false-positive safety check discovered live on
 * 2026-09-09: FlareSolverr reported "Challenge not detected!" / HTTP 200 for
 * That'sThem's opt-out page, but the actual response body was still the
 * Turnstile "Security Check" interstitial. Without this check, a caller
 * would wrongly treat an unsolved interactive challenge as a cleared page.
 */
describe("FlareSolverrClient.isLikelyStillChallenged", () => {
  const client = new FlareSolverrClient("http://localhost:8191");

  it("detects the exact That'sThem false-positive page (title=Security Check)", () => {
    const html = `<html><head><title>Security Check</title></head><body>Confirm you're human</body></html>`;
    expect(client.isLikelyStillChallenged(html)).toBe(true);
  });

  it("detects a raw cf-turnstile widget marker", () => {
    const html = `<div class="cf-turnstile" data-sitekey="abc"></div>`;
    expect(client.isLikelyStillChallenged(html)).toBe(true);
  });

  it("detects a passive 'checking your browser' interstitial", () => {
    const html = `<body>Checking your browser before accessing example.com</body>`;
    expect(client.isLikelyStillChallenged(html)).toBe(true);
  });

  it("does not flag a genuine, real page as still-challenged", () => {
    const html = `<html><head><title>Opt out — Right to Opt-Out of Sale and Sharing</title></head>
      <body><form><input name="firstname"><button type="submit">Submit</button></form></body></html>`;
    expect(client.isLikelyStillChallenged(html)).toBe(false);
  });

  it("does not false-positive on unrelated pages mentioning 'security' in passing", () => {
    const html = `<html><head><title>Account Security Settings</title></head><body>Update your password.</body></html>`;
    expect(client.isLikelyStillChallenged(html)).toBe(false);
  });
});
