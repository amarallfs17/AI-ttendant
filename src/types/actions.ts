import { z } from "zod";

/**
 * The four things the agent may decide to do (claude.md §7).
 *
 * These schemas are the single source of truth: `z.toJSONSchema` turns them
 * into the tool declarations sent to the provider, and the same schema
 * validates whatever comes back.
 *
 * They are strict on purpose. Zod would otherwise strip an unexpected field
 * and succeed, which is safe but silent — and since the prompts are public and
 * anyone can try to steer the agent (claude.md §8), an off-contract field is
 * something to see in the log, not to quietly discard.
 */
export const actionSchemas = {
  answerFaq: z.strictObject({
    answer: z
      .string()
      .min(1)
      .describe("Resposta curta e direta para o colaborador, em pt-BR."),
  }),

  collectTicketData: z.strictObject({
    question: z
      .string()
      .min(1)
      .describe("A próxima pergunta a fazer para completar o chamado."),
  }),

  checkTicketStatus: z.strictObject({}),

  escalateToHuman: z.strictObject({
    reason: z
      .string()
      .min(1)
      .describe("Por que este caso precisa de uma pessoa. Não é mostrado ao usuário."),
  }),
} as const;

export type ActionName = keyof typeof actionSchemas;

export const ACTION_NAMES = Object.keys(actionSchemas) as ActionName[];

export function isActionName(value: string): value is ActionName {
  return Object.hasOwn(actionSchemas, value);
}

export type ActionInput<N extends ActionName> = z.infer<(typeof actionSchemas)[N]>;

/** A validated decision. Nothing else may reach the handlers. */
export type Action = {
  [N in ActionName]: { name: N; input: ActionInput<N> };
}[ActionName];

const descriptions: Record<ActionName, string> = {
  answerFaq:
    "Responder uma dúvida do colaborador usando a base de conhecimento fornecida. Use quando a resposta estiver no material.",
  collectTicketData:
    "Iniciar ou continuar a coleta de informações para abrir um chamado. Use quando houver um problema que precisa de atendimento.",
  checkTicketStatus:
    "Consultar o andamento dos chamados já abertos pelo colaborador. Use quando ele perguntar sobre um chamado existente.",
  escalateToHuman:
    "Encaminhar para uma pessoa do suporte. Use quando o colaborador pedir explicitamente, ou quando o caso for sensível ou urgente demais.",
};

export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** Tool declarations for the provider, generated from the schemas above. */
export function buildToolDeclarations(): ToolDeclaration[] {
  return ACTION_NAMES.map((name) => ({
    name,
    description: descriptions[name],
    parameters: z.toJSONSchema(actionSchemas[name]) as Record<string, unknown>,
  }));
}
