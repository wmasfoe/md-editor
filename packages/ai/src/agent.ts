import type { AiContextSnapshot } from "./types.ts";

export type AiAgentStepKind = "context" | "request" | "parse";

export interface AiAgentStepDescriptor {
  readonly id: string;
  readonly kind: AiAgentStepKind;
  readonly description: string;
}

export interface AiAgentPlanDescriptor {
  readonly id: string;
  readonly goal: string;
  readonly steps: readonly AiAgentStepDescriptor[];
}

export interface AiAgentInput {
  readonly context: AiContextSnapshot;
  readonly plan?: AiAgentPlanDescriptor;
}

export interface AiAgentResult<TOutput = unknown> {
  readonly output: TOutput;
  readonly steps: readonly AiAgentStepDescriptor[];
}
