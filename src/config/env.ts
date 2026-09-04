import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),

  // Ignored events, deduplication hits and queue ordering are logged at debug:
  // raise this to diagnose why a given conversation behaved the way it did.
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),

  // Internal network URL, without a trailing slash (e.g. http://evolution:8080).
  EVOLUTION_BASE_URL: z
    .url({ protocol: /^https?$/ })
    .refine((value) => !value.endsWith("/"), "must not end with a slash"),
  EVOLUTION_API_KEY: z.string().min(1),
  EVOLUTION_INSTANCE: z.string().min(1),

  // Silence that closes a message block, and the cap that answers someone who
  // never stops typing (claude.md §7 — long windows read as a dead bot).
  DEBOUNCE_SECONDS: z.coerce.number().positive().default(10),
  DEBOUNCE_MAX_SECONDS: z.coerce.number().positive().default(45),
  CONVERSATION_TIMEOUT_HOURS: z.coerce.number().nonnegative().default(24),

  // Applied to CSV numbers that arrive without one. Configurable because
  // hardcoding the maintainer's country would break every other clone
  // (claude.md §1).
  DEFAULT_COUNTRY_CODE: z.string().regex(/^\d{1,3}$/).default("55"),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema
    .refine(
      (env) => env.DEBOUNCE_MAX_SECONDS >= env.DEBOUNCE_SECONDS,
      {
        path: ["DEBOUNCE_MAX_SECONDS"],
        message: "must be greater than or equal to DEBOUNCE_SECONDS",
      },
    )
    .safeParse(source);
  if (result.success) {
    return result.data;
  }

  const issues = result.error.issues
    .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
  throw new Error(`Invalid environment configuration:\n${issues}`);
}
