import type { FastifyInstance } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    /** The untouched JSON body, needed to verify webhook signatures. */
    rawBody?: string;
  }
}

/**
 * Keeps the raw JSON body alongside the parsed one.
 *
 * Signatures are computed over the exact bytes that were sent, and
 * re-serializing a parsed object does not reproduce them: key order, spacing
 * and unicode escaping all differ. Fastify discards the raw text by default,
 * so this replaces the JSON parser with one that keeps both.
 *
 * The parsed `request.body` keeps behaving exactly as before — the WhatsApp
 * route depends on it.
 */
export function registerRawBody(app: FastifyInstance): void {
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (request, body, done) => {
      const raw = typeof body === "string" ? body : body.toString("utf8");
      request.rawBody = raw;

      if (raw.trim() === "") {
        done(null, undefined);
        return;
      }

      try {
        done(null, JSON.parse(raw));
      } catch (error) {
        // Same shape Fastify uses, so malformed JSON still answers 400.
        const failure = error as Error & { statusCode?: number };
        failure.statusCode = 400;
        done(failure, undefined);
      }
    },
  );
}
