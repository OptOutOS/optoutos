import { describe, it, expect, vi } from "vitest";
import { detectAntiBotInHtml, hasAntiBotMarkerOnPage, ANTI_BOT_CSS_SELECTOR } from "./detection.js";
import type { Page } from "playwright";

/**
 * Regression tests for the shared anti-bot detection helper.
 *
 * WHY THIS EXISTS: before this module, six different adapter files each
 * hand-rolled a slightly different version of "does this page show a
 * Turnstile/reCAPTCHA/hCaptcha/Cloudflare-block marker" — with real,
 * observed drift between them (some checked page.locator only, some
 * checked raw HTML only, some missed hCaptcha, one used a different
 * selector union than the others). Consolidating into one tested helper
 * means every future adapter gets the full, currently-known marker set by
 * construction, and a marker discovered on one broker automatically
 * benefits every other adapter using this helper.
 */
describe("detectAntiBotInHtml", () => {
  it("detects a Cloudflare Turnstile widget", () => {
    expect(detectAntiBotInHtml('<div class="cf-turnstile" data-sitekey="x"></div>')).toBe(true);
  });

  it("detects a Cloudflare challenge widget by id", () => {
    expect(detectAntiBotInHtml('<div id="cf-turnstile"></div>')).toBe(true);
  });

  it("detects a generic Cloudflare challenge widget class", () => {
    expect(detectAntiBotInHtml('<div class="cf-chl-widget-abc123"></div>')).toBe(true);
  });

  it("detects Google reCAPTCHA by class", () => {
    expect(detectAntiBotInHtml('<div class="g-recaptcha" data-sitekey="x"></div>')).toBe(true);
  });

  it("detects hCaptcha by class", () => {
    expect(detectAntiBotInHtml('<div class="h-captcha" data-sitekey="x"></div>')).toBe(true);
  });

  it("detects a bare data-sitekey attribute (used by multiple providers)", () => {
    expect(detectAntiBotInHtml('<div data-sitekey="abc123"></div>')).toBe(true);
  });

  it("detects Cloudflare block/attention pages by title-like text", () => {
    expect(detectAntiBotInHtml("<title>Attention Required! | Cloudflare</title>")).toBe(true);
  });

  it("detects Cloudflare 'sorry, you have been blocked' body text", () => {
    expect(detectAntiBotInHtml("<body>Sorry, you have been blocked</body>")).toBe(true);
  });

  it("detects reCAPTCHA/hCaptcha/Turnstile mentioned in plain page text (JS-rendered apps)", () => {
    expect(detectAntiBotInHtml("<p>This site is protected by reCAPTCHA</p>")).toBe(true);
    expect(detectAntiBotInHtml("<p>Protected by hCaptcha</p>")).toBe(true);
    expect(detectAntiBotInHtml("<p>Cloudflare Turnstile verification required</p>")).toBe(true);
  });

  it("returns false for ordinary page markup with none of the markers", () => {
    expect(
      detectAntiBotInHtml('<form id="search"><input name="firstName"></form>'),
    ).toBe(false);
  });

  it("returns false for empty or malformed HTML (fails closed, never throws)", () => {
    expect(() => detectAntiBotInHtml("")).not.toThrow();
    expect(detectAntiBotInHtml("")).toBe(false);
  });
});

describe("hasAntiBotMarkerOnPage", () => {
  function makeFakePage(opts: { selectorCount?: number; html?: string }): Page {
    const selectorCount = opts.selectorCount ?? 0;
    const html = opts.html ?? "<html></html>";
    return {
      locator: vi.fn(() => ({
        count: vi.fn(async () => selectorCount),
      })),
      content: vi.fn(async () => html),
    } as unknown as Page;
  }

  it("returns true when the CSS locator finds a matching element", async () => {
    const page = makeFakePage({ selectorCount: 1 });
    expect(await hasAntiBotMarkerOnPage(page)).toBe(true);
  });

  it("returns true when no locator match but the raw HTML mentions a marker", async () => {
    const page = makeFakePage({ selectorCount: 0, html: '<script>var x = "cf-turnstile";</script>' });
    expect(await hasAntiBotMarkerOnPage(page)).toBe(true);
  });

  it("returns false when neither the locator nor the HTML show a marker", async () => {
    const page = makeFakePage({ selectorCount: 0, html: "<form></form>" });
    expect(await hasAntiBotMarkerOnPage(page)).toBe(false);
  });

  it("uses the shared ANTI_BOT_CSS_SELECTOR constant so adapters stay in sync", () => {
    const page = makeFakePage({});
    void hasAntiBotMarkerOnPage(page);
    expect(page.locator).toHaveBeenCalledWith(ANTI_BOT_CSS_SELECTOR);
  });
});
