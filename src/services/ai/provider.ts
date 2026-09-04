export type AiContentPart =
  | { type: "text"; text: string }
  // Accepted now because phase 8 sends screenshots, and widening the interface
  // later would touch every implementation.
  | { type: "image"; mimeType: string; base64: string };

export interface AiMessage {
  role: "user" | "model";
  parts: AiContentPart[];
}

export interface AiToolDefinition {
  name: string;
  description: string;
  /** JSON Schema; generated from the Zod schemas in types/actions.ts. */
  parameters: Record<string, unknown>;
}

export interface AiRequest {
  system: string;
  messages: AiMessage[];
  tools?: AiToolDefinition[];
}

export interface AiCompletion {
  toolCall?: { name: string; input: unknown };
  text?: string;
}

/**
 * The only shape the rest of the code knows. Nothing outside `services/ai/`
 * imports a provider SDK or sees a provider-specific type (claude.md §5).
 */
export interface AiProvider {
  complete(request: AiRequest): Promise<AiCompletion>;
}
