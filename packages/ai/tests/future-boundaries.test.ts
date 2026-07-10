import { describe, expect, it } from "vitest";
import type { AiAgentPlanDescriptor, AiContextConnector } from "../src/index.ts";
import { createAiCacheKey } from "../src/index.ts";

describe("future AI boundaries", () => {
  it("creates deterministic cache keys without owning cache storage", () => {
    expect(
      createAiCacheKey({
        namespace: "completion",
        provider: "openai-compatible",
        model: "writer-model",
        seed: "context",
      }),
    ).toBe(JSON.stringify(["completion", "openai-compatible", "writer-model", "context"]));
  });

  it("keeps cache keys collision-resistant when fields contain separators", () => {
    expect(
      createAiCacheKey({
        namespace: "completion:a",
        provider: "b",
        model: "c",
        seed: "d",
      }),
    ).not.toBe(
      createAiCacheKey({
        namespace: "completion",
        provider: "a:b",
        model: "c",
        seed: "d",
      }),
    );
  });

  it("defines connector and agent descriptors without a runtime", async () => {
    const connector: AiContextConnector = {
      descriptor: {
        id: "editor",
        label: "Editor",
        capabilities: ["context.snapshot"],
      },
      getSnapshot: () => ({
        before: "Hello",
        after: "",
        selectedText: "",
        mode: "wysiwyg",
      }),
    };
    const plan: AiAgentPlanDescriptor = {
      id: "writing",
      goal: "Prepare writing suggestion",
      steps: [
        {
          id: "context",
          kind: "context",
          description: "Read a context snapshot from a connector.",
        },
      ],
    };

    await expect(Promise.resolve(connector.getSnapshot())).resolves.toMatchObject({
      before: "Hello",
    });
    expect(plan.steps[0]?.kind).toBe("context");
  });
});
