import { z } from "zod";

/**
 * JSON Schema a language-model API will accept as a tool's arguments.
 *
 * Zod 4's own JSON Schema is written for validators, not for model providers. It leads with a
 * `$schema` draft URI and sets `additionalProperties: false` on every object. CopilotKit
 * Intelligence is a FastAPI service: extra fields on a tool schema are a 422 Unprocessable Entity,
 * which is how a `search_web` call was reaching the person as a red status line instead of a result.
 *
 * Stripping those two is the whole job. Required, type, properties, enum, and descriptions stay.
 */

const DROP = new Set(["$schema", "$id", "additionalProperties"]);

export function jsonSchemaForLlmTool(
  schema: z.ZodType,
): Record<string, unknown> {
  return strip(z.toJSONSchema(schema)) as Record<string, unknown>;
}

/**
 * The same schema, as Standard Schema, so CopilotKit's BuiltInAgent converts it through JSON Schema
 * rather than handing Zod 4 to the model provider.
 *
 * BuiltInAgent detects Zod and passes it straight to the AI SDK, which then emits the draft URI
 * again. A Standard Schema that is not Zod goes through `jsonSchema()`, and that is the cleaned
 * object.
 */
export function standardSchemaForLlmTool(schema: z.ZodType) {
  const json = jsonSchemaForLlmTool(schema);
  return {
    "~standard": {
      version: 1 as const,
      vendor: "openbot",
      validate: (value: unknown) => {
        const parsed = schema.safeParse(value);
        return parsed.success
          ? { value: parsed.data }
          : {
              issues: parsed.error.issues.map((issue) => ({
                message: issue.message,
                path: issue.path,
              })),
            };
      },
      jsonSchema: {
        input: () => json,
      },
    },
  };
}

function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip);
  if (!value || typeof value !== "object") return value;
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (DROP.has(key)) continue;
    next[key] = strip(child);
  }
  return next;
}
