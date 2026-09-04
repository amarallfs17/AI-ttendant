import type { HistoryEntry } from "./triage.js";

/** Turns kept verbatim before the older ones get compacted. */
export const HISTORY_WINDOW = 20;

export interface StoredMessage {
  id: string;
  direction: "inbound" | "outbound";
  content: string | null;
}

export interface HistorySummary {
  text: string;
  /** Everything up to and including this message id is already summarized. */
  coveredThroughId: string;
}

export interface HistoryPlan {
  /** Turns to send verbatim, oldest first. */
  recent: HistoryEntry[];
  /** Turns to fold into the summary; empty when nothing needs compacting. */
  toSummarize: HistoryEntry[];
  /** New marker once `toSummarize` has been compacted. */
  newCoveredThroughId?: string;
}

function toEntry(message: StoredMessage): HistoryEntry {
  return {
    role: message.direction === "inbound" ? "user" : "model",
    text: message.content ?? "",
  };
}

/**
 * Decides what the model reads: the last N turns verbatim, and which older
 * ones must be folded into the running summary so cost and confusion stop
 * growing with the conversation (claude.md §8).
 *
 * Pure on purpose — the caller performs the summarizing call.
 */
export function planHistory(
  messages: readonly StoredMessage[],
  summary: HistorySummary | null,
): HistoryPlan {
  const startIndex = summary
    ? messages.findIndex((message) => message.id === summary.coveredThroughId) + 1
    : 0;

  // A marker pointing at a message that no longer exists (retention, manual
  // cleanup) would silently drop history; fall back to using everything.
  const uncovered = messages.slice(startIndex > 0 ? startIndex : 0);
  const usable = uncovered.filter((message) => (message.content ?? "").trim() !== "");

  if (usable.length <= HISTORY_WINDOW) {
    return { recent: usable.map(toEntry), toSummarize: [] };
  }

  const overflow = usable.slice(0, usable.length - HISTORY_WINDOW);
  const recent = usable.slice(usable.length - HISTORY_WINDOW);

  return {
    recent: recent.map(toEntry),
    toSummarize: overflow.map(toEntry),
    newCoveredThroughId: overflow[overflow.length - 1]?.id ?? undefined,
  };
}

/** The instruction used when compacting older turns. */
export const SUMMARY_PROMPT =
  "Resuma a conversa abaixo em no máximo 5 frases, em pt-BR. " +
  "Preserve: o problema relatado, dados já informados pelo colaborador e o que " +
  "já foi respondido ou combinado. Não invente informação.";

export function buildSummaryInput(
  previous: HistorySummary | null,
  toSummarize: readonly HistoryEntry[],
): string {
  const lines = toSummarize.map(
    (entry) => `${entry.role === "user" ? "Colaborador" : "Atendente"}: ${entry.text}`,
  );
  return previous
    ? `Resumo anterior:\n${previous.text}\n\nNovas mensagens:\n${lines.join("\n")}`
    : lines.join("\n");
}
