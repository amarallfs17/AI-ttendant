import { timeUntilFlush, type DebounceConfig } from "../logic/debounce.js";
import type { InboundMessage, PresenceState } from "../logic/inboundMessage.js";

/**
 * Only a "composing" from the last few seconds means someone is typing *now*.
 * This has to stay well under DEBOUNCE_SECONDS: a limit as long as the window
 * would make any typing signal received during it extend the block, which is
 * the opposite of the intent. WhatsApp re-sends composing while the person
 * keeps writing, so a fresh signal is always available when it matters.
 */
const PRESENCE_FRESHNESS_MS = 5_000;

export interface DebounceLogger {
  debug: (obj: object, message: string) => void;
}

export interface DebounceBuffer {
  add(message: InboundMessage): void;
  notePresence(phone: string, presence: PresenceState): void;
  /** Releases every open window immediately; used on shutdown. */
  flushAll(): void;
  pending(): number;
}

interface Window {
  messages: InboundMessage[];
  firstMessageAt: number;
  lastMessageAt: number;
  timer: NodeJS.Timeout | null;
  extended: boolean;
}

/**
 * Groups bursts of messages into one block per phone (claude.md §7): people
 * write in short pieces, and answering each one separately fragments the
 * conversation and wastes API calls.
 *
 * Timers live here on purpose — `logic/debounce.ts` only answers "how long
 * still to wait", so the rule stays testable without real time.
 */
export function createDebounceBuffer(
  config: DebounceConfig,
  log: DebounceLogger,
  onFlush: (phone: string, messages: InboundMessage[]) => void,
): DebounceBuffer {
  const windows = new Map<string, Window>();
  const presence = new Map<string, { state: PresenceState; at: number }>();

  const release = (phone: string): void => {
    const window = windows.get(phone);
    if (!window) return;

    if (window.timer) clearTimeout(window.timer);
    windows.delete(phone);
    presence.delete(phone);

    log.debug(
      { phone, blockSize: window.messages.length, extended: window.extended },
      "debounce window flushed",
    );
    onFlush(phone, window.messages);
  };

  const schedule = (phone: string, window: Window): void => {
    const waitMs = timeUntilFlush(window, config, Date.now());
    window.timer = setTimeout(() => {
      const typing = presence.get(phone);
      const stillTyping =
        typing?.state === "typing" &&
        Date.now() - typing.at <= PRESENCE_FRESHNESS_MS;

      // Give someone who is visibly still writing one more window, never more,
      // and never past the hard cap.
      const remainingToCap = timeUntilFlush(
        { ...window, lastMessageAt: Date.now() },
        config,
        Date.now(),
      );
      if (stillTyping && !window.extended && remainingToCap > 0) {
        window.extended = true;
        log.debug({ phone, waitMs: remainingToCap }, "debounce extended: still typing");
        window.timer = setTimeout(() => release(phone), remainingToCap);
        return;
      }

      release(phone);
    }, waitMs);
  };

  return {
    add(message) {
      const now = Date.now();
      const existing = windows.get(message.phone);

      if (existing) {
        if (existing.timer) clearTimeout(existing.timer);
        existing.messages.push(message);
        existing.lastMessageAt = now;
        schedule(message.phone, existing);
        return;
      }

      const window: Window = {
        messages: [message],
        firstMessageAt: now,
        lastMessageAt: now,
        timer: null,
        extended: false,
      };
      windows.set(message.phone, window);
      schedule(message.phone, window);
    },

    notePresence(phone, state) {
      // Only useful while a window is open for that phone.
      if (!windows.has(phone)) return;
      presence.set(phone, { state, at: Date.now() });
    },

    flushAll() {
      for (const phone of [...windows.keys()]) {
        release(phone);
      }
    },

    pending() {
      return windows.size;
    },
  };
}
