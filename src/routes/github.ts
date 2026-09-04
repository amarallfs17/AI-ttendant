import { createHmac, timingSafeEqual } from "node:crypto";

import type { FastifyPluginAsync } from "fastify";

import { refreshExternalContext } from "../services/context.js";
import type { AppContext } from "../types/context.js";

/**
 * Verifies GitHub's `X-Hub-Signature-256` over the raw body.
 *
 * `timingSafeEqual` rather than `===`: comparing byte by byte and returning
 * early leaks, through response time, how much of a forged signature was
 * correct — enough to reconstruct it one character at a time.
 */
export function isValidSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader?.startsWith("sha256=")) {
    return false;
  }

  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const received = Buffer.from(signatureHeader, "utf8");
  const computed = Buffer.from(expected, "utf8");

  // timingSafeEqual throws on differing lengths, which would itself be a leak.
  if (received.length !== computed.length) {
    return false;
  }

  return timingSafeEqual(received, computed);
}

/**
 * Refetches the external context when the repository holding it is pushed to.
 * Only mounted when a secret is configured — an unauthenticated refresh
 * endpoint is a free way to make the server fetch a URL repeatedly.
 */
export function createGithubRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.post("/webhook/github", async (request, reply) => {
      const secret = ctx.env.GITHUB_WEBHOOK_SECRET;
      if (!secret) {
        return reply.code(404).send({ error: "not found" });
      }

      const signature = request.headers["x-hub-signature-256"];
      const rawBody = request.rawBody ?? "";

      if (!isValidSignature(rawBody, typeof signature === "string" ? signature : undefined, secret)) {
        // Never log the body of a request that failed authentication.
        request.log.warn(
          { ip: request.ip, event: request.headers["x-github-event"] },
          "rejected github webhook with an invalid signature",
        );
        return reply.code(401).send({ error: "invalid signature" });
      }

      const event = request.headers["x-github-event"];
      if (event !== "push") {
        request.log.debug({ event }, "github event ignored");
        return reply.code(200).send({ received: true });
      }

      const refreshed = await refreshExternalContext(
        ctx.pool,
        ctx.env.CONTEXT_MD_URL,
        request.log,
      );

      return reply.code(200).send({ received: true, refreshed });
    });
  };
}
