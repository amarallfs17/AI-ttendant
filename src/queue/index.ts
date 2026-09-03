export interface QueueLogger {
  debug: (obj: object, message: string) => void;
  error: (obj: object, message: string) => void;
}

export interface Queue {
  /** Runs `task` after every task already queued for `phone` has finished. */
  enqueue(phone: string, task: () => Promise<void>): void;
  /** Resolves once every queued task has settled. Used on shutdown. */
  drain(): Promise<void>;
  /** Number of phones with work in flight. */
  pending(): number;
}

/**
 * Serialization per phone IS the conversation lock (claude.md §8): each phone
 * gets a promise chain, so its messages never run in parallel, while different
 * phones stay independent.
 */
export function createQueue(log: QueueLogger): Queue {
  const chains = new Map<string, Promise<void>>();

  return {
    enqueue(phone, task) {
      const previous = chains.get(phone) ?? Promise.resolve();

      const current = previous.then(async () => {
        log.debug({ phone }, "queue task started");
        try {
          await task();
          log.debug({ phone }, "queue task finished");
        } catch (error) {
          // Never let one task break the chain for that phone.
          log.error({ phone, err: error }, "queue task failed");
        }
      });

      chains.set(phone, current);

      void current.then(() => {
        if (chains.get(phone) === current) {
          chains.delete(phone);
        }
      });
    },

    async drain() {
      while (chains.size > 0) {
        await Promise.allSettled([...chains.values()]);
      }
    },

    pending() {
      return chains.size;
    },
  };
}
