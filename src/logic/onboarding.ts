export interface Employee {
  phone: string;
  name: string;
  department: string;
  email: string | null;
  source: "csv" | "auto";
}

export interface OnboardingState {
  step: "awaitingName" | "awaitingDepartment";
  /** Profile name offered for confirmation; never trusted as identity. */
  suggestedName?: string;
  name?: string;
  /** The message that started the conversation, answered once we know who they are. */
  pendingText?: string;
  /** Rejected answers so far, so nobody gets stuck being asked forever. */
  attempts: number;
}

export type OnboardingAction =
  | { kind: "ask"; text: string; next: OnboardingState }
  | { kind: "register"; name: string; department: string; pendingText?: string };

const MIN_ANSWER_LENGTH = 2;
const MAX_ANSWER_LENGTH = 60;
/** After this many rejections we take what we were given, truncated. */
const MAX_ATTEMPTS = 2;

const AFFIRMATIVES = new Set([
  "sim",
  "s",
  "isso",
  "sou",
  "sou eu",
  "correto",
  "exato",
  "isso mesmo",
  "confirmo",
  "positivo",
  "yes",
  "y",
  "ok",
  "👍",
]);

function isAffirmative(text: string): boolean {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/, "");
  return AFFIRMATIVES.has(normalized);
}

function cleanAnswer(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Counts what a person sees, not UTF-16 units: a single emoji is two units
 * long, and would otherwise pass as a name.
 */
function visibleLength(value: string): number {
  return [...value].length;
}

function isPlausibleAnswer(value: string): boolean {
  const length = visibleLength(value);
  return length >= MIN_ANSWER_LENGTH && length <= MAX_ANSWER_LENGTH;
}

/**
 * Drives the registration of someone we have never seen, without involving the
 * model: it is a two-question form, and asking an LLM to run it would only add
 * cost and failure modes.
 *
 * `current` is null on first contact. The caller persists `next` in
 * `conversations.partial_data.onboarding` and stops; the following block comes
 * back here with that state.
 */
export function advanceOnboarding(
  current: OnboardingState | null,
  input: { text: string; pushName: string | null },
): OnboardingAction {
  const answer = cleanAnswer(input.text);

  if (!current) {
    const suggested = input.pushName ? cleanAnswer(input.pushName) : "";
    // The profile name is a suggestion to confirm, never an identity: people
    // set it to nicknames, emoji or company slogans (claude.md §7).
    if (suggested && isPlausibleAnswer(suggested)) {
      return {
        kind: "ask",
        text: `Olá! Antes de continuar, preciso saber com quem estou falando. Você é *${suggested}*? Se não for, é só me dizer seu nome.`,
        next: {
          step: "awaitingName",
          suggestedName: suggested,
          pendingText: answer || undefined,
          attempts: 0,
        },
      };
    }

    return {
      kind: "ask",
      text: "Olá! Antes de continuar, preciso saber com quem estou falando. Qual é o seu nome?",
      next: {
        step: "awaitingName",
        pendingText: answer || undefined,
        attempts: 0,
      },
    };
  }

  if (current.step === "awaitingName") {
    const confirmed = current.suggestedName !== undefined && isAffirmative(answer);
    const candidate = confirmed ? current.suggestedName : answer;
    const accepted = acceptOrRetry(candidate ?? answer, current);

    if (!accepted.ok) {
      return {
        kind: "ask",
        text: "Só preciso do seu nome, pode ser só o primeiro. Como devo te chamar?",
        next: { ...current, attempts: accepted.attempts },
      };
    }

    return {
      kind: "ask",
      text: `Obrigado, ${accepted.value}! Em qual setor você trabalha?`,
      next: {
        step: "awaitingDepartment",
        name: accepted.value,
        pendingText: current.pendingText,
        attempts: 0,
      },
    };
  }

  const accepted = acceptOrRetry(answer, current);
  if (!accepted.ok) {
    return {
      kind: "ask",
      text: "Qual é o seu setor? Por exemplo: Financeiro, Comercial, Operações.",
      next: { ...current, attempts: accepted.attempts },
    };
  }

  return {
    kind: "register",
    name: current.name ?? "",
    department: accepted.value,
    pendingText: current.pendingText,
  };
}

/**
 * Takes the answer, or asks again — but only while there is room to. Someone
 * who keeps describing their problem instead of answering would otherwise be
 * trapped in the form, which is worse than storing an imperfect value.
 */
function acceptOrRetry(
  candidate: string,
  current: OnboardingState,
): { ok: true; value: string } | { ok: false; attempts: number } {
  const value = cleanAnswer(candidate);

  if (isPlausibleAnswer(value)) {
    return { ok: true, value };
  }

  const attempts = current.attempts + 1;
  if (attempts >= MAX_ATTEMPTS && visibleLength(value) >= MIN_ANSWER_LENGTH) {
    // Slicing by code point so truncation never splits a character in half.
    return { ok: true, value: [...value].slice(0, MAX_ANSWER_LENGTH).join("") };
  }

  return { ok: false, attempts };
}
