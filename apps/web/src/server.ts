import Fastify, { type FastifyInstance } from "fastify";
import { resolveUnlockSource, InMemoryPassphraseSession } from "@optoutos/core";

/**
 * OptOutOS web GUI server.
 *
 * SECURITY POSTURE (see docs/DESIGN.md "Web GUI" decision,
 * THREAT_MODEL.md): local-only by design. `start()` binds to 127.0.0.1
 * exclusively — never 0.0.0.0 — so the household store's decrypted
 * contents and any unlocked in-memory passphrase are never reachable from
 * the network, matching the CLI's local-first trust model. There is
 * intentionally no remote-access mode; a user who wants remote access is
 * expected to use their own VPN/SSH tunnel, exactly as they would for any
 * other localhost-only admin tool (this project does not reinvent that).
 *
 * Unlock policy (user decision, 2026-09-10): BWS-backed unlock is
 * primary; an in-memory-only passphrase prompt is the fallback for users
 * without Bitwarden configured. See packages/core/src/web/unlock.ts for
 * the resolution logic and the passphrase session's memory-safety
 * properties (never logged, auto-expires on idle).
 *
 * This is the FIRST vertical slice of the web GUI (unlock/session only).
 * Household management, broker-status dashboard, and run control are
 * separate, later slices — see docs/ROADMAP.md.
 */
export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: false });
  const passphraseSession = new InMemoryPassphraseSession();

  app.get("/api/unlock/status", async (_req, reply) => {
    const source = resolveUnlockSource();
    const locked = source.kind === "bws" ? true : !passphraseSession.hasPassphrase();
    return reply.send({ source: source.kind, locked });
  });

  app.post<{ Body: { passphrase?: string } }>("/api/unlock", async (req, reply) => {
    const source = resolveUnlockSource();
    if (source.kind === "bws") {
      // BWS mode never accepts a raw passphrase over HTTP — unlocking in
      // that mode means BWS_ACCESS_TOKEN is already present in the
      // server's own environment; there is nothing for the browser to
      // submit. Reject explicitly rather than silently ignoring the body.
      return reply.status(409).send({
        error: "This server is configured for BWS-backed unlock; no passphrase is needed or accepted.",
      });
    }

    const passphrase = req.body?.passphrase;
    if (!passphrase || typeof passphrase !== "string") {
      return reply.status(400).send({ error: "Missing required field: passphrase" });
    }

    passphraseSession.unlock(passphrase);
    return reply.send({ locked: false });
  });

  app.post("/api/lock", async (_req, reply) => {
    passphraseSession.lock();
    return reply.send({ locked: true });
  });

  return app;
}

/**
 * Starts the server bound to 127.0.0.1 only. Not called from tests
 * (which use Fastify's inject() and never open a real socket) — only from
 * the actual CLI entry point (src/cli.ts, added in a later slice) or a
 * manual `npm start`.
 */
export async function start(port = 4173): Promise<FastifyInstance> {
  const app = buildServer();
  await app.listen({ port, host: "127.0.0.1" });
  return app;
}
