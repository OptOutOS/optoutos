import { Hono } from "hono";
import { serve, type ServerType } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { access } from "node:fs/promises";
import {
  resolveUnlockSource,
  InMemoryPassphraseSession,
  LocalEncryptedFileStore,
  addPerson,
  editPerson,
  listPeople,
  listBrokerIds,
  getBrokerAdapter,
  type PeopleStore,
  type PersonFieldsInput,
} from "@optoutos/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
// dist/server.js -> ../public (public/ sits next to src/ at the package root).
const PUBLIC_DIR = join(__dirname, "..", "public");

/**
 * OptOutOS web GUI server.
 *
 * FRAMEWORK: Hono (+ @hono/node-server for the Node runtime, +
 * @hono/node-server/serve-static for static assets). Switched from an
 * initial Fastify pick after the user asked for a real comparison, which
 * hadn't been done before choosing Fastify — see docs/DESIGN.md decision
 * 12 for the full comparison table. Hono fits this project's existing
 * conventions better (zod-first schema validation throughout the
 * codebase, TypeScript-first route typing) and is more portable if a
 * future deployment shape changes (Node/Deno/Bun/Workers).
 *
 * DEPENDENCY VERSIONS ARE SECURITY-PINNED, NOT ARBITRARY: `hono` >=4.12.25
 * fixes CVE-2026-54286 (Windows-specific path traversal via encoded
 * backslash %5C — directly relevant since this project runs on Windows);
 * `@hono/node-server` >=2.0.5 (or 1.19.15) fixes GHSA-92pp-h63x-v22m
 * (repeated-slash middleware bypass) and CVE-2026-29087 (auth bypass via
 * inconsistent URL decoding between routing and static resolution).
 * package.json pins ^4.13.7 / ^2.1.1 — versions well past both fixes,
 * verified via `npm view` against the registry at pin time (2026-09-10).
 * `npm audit` must report 0 vulnerabilities before this dependency is
 * trusted, same standard as every other dependency in this project.
 *
 * SECURITY POSTURE (see docs/DESIGN.md "Web GUI" decision,
 * THREAT_MODEL.md): this server binds to 127.0.0.1 ONLY (never 0.0.0.0)
 * — see start() below — matching the CLI's local-first trust model. The
 * household store's decrypted contents and any in-memory passphrase must
 * never be reachable from the network. Tests use Hono's app.request()
 * (an in-process fetch, no real socket) so this suite never needs a live
 * port.
 *
 * Unlock policy (user decision, 2026-09-10): BWS-backed unlock is
 * primary; an in-memory-only passphrase prompt is the fallback for users
 * without Bitwarden configured. See packages/core/src/web/unlock.ts for
 * the resolution logic and the passphrase session's memory-safety
 * properties (never logged, auto-expires on idle).
 */
export function buildServer(): Hono {
  const app = new Hono();
  const passphraseSession = new InMemoryPassphraseSession();

  async function storeExists(): Promise<boolean> {
    const storePath = process.env.OPTOUTOS_WEB_STORE_PATH;
    if (!storePath) return false;
    try {
      await access(storePath);
      return true;
    } catch {
      return false;
    }
  }

  app.get("/api/unlock/status", async (c) => {
    const source = resolveUnlockSource();
    const locked = source.kind === "bws" ? true : !passphraseSession.hasPassphrase();
    return c.json({
      source: source.kind,
      locked,
      storeConfigured: !!process.env.OPTOUTOS_WEB_STORE_PATH,
      storeExists: await storeExists(),
    });
  });

  app.post("/api/unlock", async (c) => {
    const source = resolveUnlockSource();
    if (source.kind === "bws") {
      // BWS mode never accepts a raw passphrase over HTTP — unlocking in
      // that mode means BWS_ACCESS_TOKEN is already present in the
      // server's own environment; there is nothing for the browser to
      // submit. Reject explicitly rather than silently ignoring the body.
      return c.json(
        { error: "This server is configured for BWS-backed unlock; no passphrase is needed or accepted." },
        409,
      );
    }

    const body = await c
      .req.json<{ passphrase?: string; confirmPassphrase?: string }>()
      .catch(() => ({}) as { passphrase?: string; confirmPassphrase?: string });
    const passphrase = body?.passphrase;
    if (!passphrase || typeof passphrase !== "string") {
      return c.json({ error: "Missing required field: passphrase" }, 400);
    }

    const alreadyExists = await storeExists();

    if (!alreadyExists) {
      // FIRST-TIME SETUP: no encrypted file exists yet, so whatever
      // passphrase is submitted here becomes the permanent one (there is
      // no recovery path for a lost passphrase, by design of the
      // encryption — see docs/THREAT_MODEL.md). Require confirmation so a
      // typo doesn't silently lock the user out of data they haven't even
      // written yet.
      if (body.confirmPassphrase !== passphrase) {
        return c.json({ error: "Passphrase and confirmation do not match." }, 400);
      }
    } else {
      // RETURNING UNLOCK: a store file already exists. Verify the
      // passphrase actually decrypts it BEFORE accepting the session as
      // unlocked — AES-GCM's auth tag makes a wrong-passphrase load()
      // throw (see packages/core/src/people/crypto.ts decryptJson), so
      // this is a real cryptographic check, not a guess.
      const storePath = process.env.OPTOUTOS_WEB_STORE_PATH!;
      try {
        await new LocalEncryptedFileStore(storePath, passphrase).load();
      } catch {
        return c.json({ error: "Incorrect passphrase." }, 401);
      }
    }

    passphraseSession.unlock(passphrase);
    return c.json({ locked: false });
  });

  app.post("/api/lock", (c) => {
    passphraseSession.lock();
    return c.json({ locked: true });
  });

  /**
   * Resolves the live PeopleStore for this request, or null if the
   * session is locked. See the equivalent Fastify-era docstring (removed
   * on the Hono rewrite) for the full rationale — unchanged behavior:
   * BWS mode not yet wired for the web GUI (issue tracked separately from
   * this framework swap); passphrase-prompt mode requires the in-memory
   * session to be unlocked AND OPTOUTOS_WEB_STORE_PATH to be configured.
   */
  function resolveHouseholdStore(): PeopleStore | null {
    const source = resolveUnlockSource();
    if (source.kind === "passphrase-prompt") {
      if (!passphraseSession.hasPassphrase()) return null;
      const storePath = process.env.OPTOUTOS_WEB_STORE_PATH;
      if (!storePath) return null;
      return new LocalEncryptedFileStore(storePath, passphraseSession.getPassphrase());
    }
    return null;
  }

  app.get("/api/people", async (c) => {
    const store = resolveHouseholdStore();
    if (!store) return c.json({ error: "Household store is locked or not configured." }, 423);

    const people = await listPeople(store);
    return c.json(people);
  });

  app.get("/api/people/:id", async (c) => {
    const store = resolveHouseholdStore();
    if (!store) return c.json({ error: "Household store is locked or not configured." }, 423);

    const people = await listPeople(store);
    const person = people.find((p) => p.id === c.req.param("id"));
    if (!person) return c.json({ error: "Person not found" }, 404);
    return c.json(person);
  });

  app.post("/api/people", async (c) => {
    const store = resolveHouseholdStore();
    if (!store) return c.json({ error: "Household store is locked or not configured." }, 423);

    const body = await c.req.json<PersonFieldsInput>().catch(() => ({}) as PersonFieldsInput);
    const { firstName, lastName } = body;
    if (!firstName || !lastName) {
      return c.json({ error: "firstName and lastName are required" }, 400);
    }

    const created = await addPerson(store, { ...body, firstName, lastName });
    return c.json(created, 201);
  });

  app.patch("/api/people/:id", async (c) => {
    const store = resolveHouseholdStore();
    if (!store) return c.json({ error: "Household store is locked or not configured." }, 423);

    const body = await c.req.json<PersonFieldsInput>().catch(() => ({}) as PersonFieldsInput);
    try {
      const updated = await editPerson(store, c.req.param("id"), body);
      return c.json(updated);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 404);
    }
  });

  app.get("/api/people/:id/dashboard", async (c) => {
    const store = resolveHouseholdStore();
    if (!store) return c.json({ error: "Household store is locked or not configured." }, 423);

    const people = await listPeople(store);
    const person = people.find((p) => p.id === c.req.param("id"));
    if (!person) return c.json({ error: "Person not found" }, 404);

    // Read-only: this is broker STATUS only, no live search/removal call
    // happens here (see docs/ROADMAP.md issue #15 for run control). One
    // row per REGISTERED broker (not just brokers this person has ever
    // been checked against), so a never-checked broker shows up
    // explicitly rather than being silently absent from the list.
    const rows = listBrokerIds().map((brokerId) => {
      const adapter = getBrokerAdapter(brokerId);
      const history = person.brokerRunHistory[brokerId];
      return {
        brokerId,
        brokerName: adapter?.brokerName ?? brokerId,
        lastRunAt: history?.lastRunAt ?? null,
        lastStatus: history?.lastStatus ?? null,
      };
    });
    return c.json(rows);
  });

  // Static asset serving (the frontend) LAST — Hono matches routes in
  // registration order for wildcard patterns, so the explicit /api/*
  // routes above must be registered first or a broad static wildcard
  // could shadow them.
  app.use("/*", serveStatic({ root: PUBLIC_DIR }));

  return app;
}

/**
 * Starts the server bound to 127.0.0.1 only. Not called from tests
 * (which use Hono's app.request(), an in-process fetch that never opens a
 * real socket) — only from the actual CLI entry point (added in a later
 * slice) or a manual `npm start`.
 */
export function start(port = 4173): ServerType {
  const app = buildServer();
  return serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
}
