import { closeStaleConversations } from "../db/queries.js";
import type { AppContext } from "../types/context.js";

const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Closes conversations left untouched for CONVERSATION_TIMEOUT_HOURS and drops
 * their partial data, so nobody comes back days later inside a stale
 * collection (claude.md §7). Returns a stop function for shutdown.
 */
export function startConversationSweeper(ctx: AppContext): () => void {
  const sweep = async (): Promise<void> => {
    try {
      const closed = await closeStaleConversations(
        ctx.pool,
        ctx.env.CONVERSATION_TIMEOUT_HOURS,
      );
      if (closed > 0) {
        ctx.log.info({ closed }, "stale conversations closed");
      }
    } catch (error) {
      // Housekeeping must never take the process down.
      ctx.log.error({ err: error }, "conversation sweep failed");
    }
  };

  void sweep();
  const timer = setInterval(() => void sweep(), SWEEP_INTERVAL_MS);

  return () => clearInterval(timer);
}
