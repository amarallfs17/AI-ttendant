import { GoogleGenAI, type Content, type FunctionDeclaration } from "@google/genai";

import { NonRetryableError } from "../errors.js";
import type { AiCompletion, AiMessage, AiProvider, AiRequest } from "./provider.js";

const REQUEST_TIMEOUT_MS = 30_000;

function toContents(messages: readonly AiMessage[]): Content[] {
  return messages.map((message) => ({
    role: message.role,
    parts: message.parts.map((part) =>
      part.type === "text"
        ? { text: part.text }
        : { inlineData: { mimeType: part.mimeType, data: part.base64 } },
    ),
  }));
}

function toFunctionDeclarations(request: AiRequest): FunctionDeclaration[] {
  return (request.tools ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description,
    // Raw JSON Schema, which is exactly what z.toJSONSchema produces — no
    // hand-maintained second copy of the contract.
    parametersJsonSchema: tool.parameters,
  }));
}

/** True for failures that repeating cannot fix: bad key, bad request, quota. */
function isPermanent(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  if (typeof status === "number") {
    return status >= 400 && status < 500 && status !== 429;
  }
  const message = error instanceof Error ? error.message : "";
  return /API key not valid|PERMISSION_DENIED|INVALID_ARGUMENT/i.test(message);
}

export function createGeminiProvider(apiKey: string, model: string): AiProvider {
  const client = new GoogleGenAI({ apiKey });

  return {
    async complete(request): Promise<AiCompletion> {
      const declarations = toFunctionDeclarations(request);

      let response;
      try {
        response = await client.models.generateContent({
          model,
          contents: toContents(request.messages),
          config: {
            systemInstruction: request.system,
            ...(declarations.length > 0
              ? { tools: [{ functionDeclarations: declarations }] }
              : {}),
            // Without this a hung provider would hold the conversation's queue
            // chain open indefinitely.
            abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          },
        });
      } catch (error) {
        if (isPermanent(error)) {
          throw new NonRetryableError(
            `gemini rejected the request: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          );
        }
        throw new Error("gemini request failed", { cause: error });
      }

      const call = response.functionCalls?.[0];
      if (call?.name) {
        return { toolCall: { name: call.name, input: call.args ?? {} } };
      }

      return { text: response.text ?? undefined };
    },
  };
}
