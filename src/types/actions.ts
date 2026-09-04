import { z } from "zod";

/** An acknowledgement is a courtesy, not a channel for free-form answers. */
const MAX_ACKNOWLEDGEMENT_LENGTH = 200;

/**
 * The five things the agent may decide to do (claude.md §7).
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
  // Routing only: the FAQ agent writes the answer, with the knowledge base in
  // front of it. Having triage write it too would be the same work twice over
  // the same material.
  answerFaq: z.strictObject({}),

  acknowledge: z.strictObject({
    reply: z
      .string()
      .min(1)
      .max(MAX_ACKNOWLEDGEMENT_LENGTH)
      .describe("Resposta curta para uma mensagem que não pede ação, em pt-BR."),
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
    "Encaminhar uma dúvida para ser respondida com a base de conhecimento. Use quando o colaborador perguntar algo que a documentação interna provavelmente cobre — procedimento, configuração, como fazer.",
  acknowledge:
    "Responder brevemente a uma mensagem que não pede nenhuma ação: agradecimento, confirmação, saudação ou despedida. Use para 'ok', 'beleza', 'obrigado', 'bom dia'.",
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
