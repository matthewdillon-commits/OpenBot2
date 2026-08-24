import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  jsonSchemaForLlmTool,
  standardSchemaForLlmTool,
} from "../src/plugins/llm-schema";

describe("JSON Schema handed to a language-model API", () => {
  const parameters = z.object({
    query: z.string().describe("What to look up."),
  });

  test("drops the draft URI and additionalProperties, which FastAPI treats as extra fields", () => {
    const schema = jsonSchemaForLlmTool(parameters);

    expect(schema.$schema).toBeUndefined();
    expect(schema.additionalProperties).toBeUndefined();
    expect(schema.type).toBe("object");
    expect(schema.properties).toMatchObject({
      query: { type: "string", description: "What to look up." },
    });
    expect(schema.required).toEqual(["query"]);
  });

  test("the Standard Schema wrapper exposes the same cleaned object", () => {
    const wrapped = standardSchemaForLlmTool(parameters);
    const json = wrapped["~standard"].jsonSchema.input();

    expect(json.$schema).toBeUndefined();
    expect(json.additionalProperties).toBeUndefined();
    expect(json.type).toBe("object");
  });
});
