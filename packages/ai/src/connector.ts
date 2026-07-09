import type { AiContextSnapshot } from "./types.ts";

export type AiConnectorCapability =
  | "context.snapshot"
  | "document.metadata"
  | "document.recent-text";

export interface AiConnectorDescriptor {
  readonly id: string;
  readonly label: string;
  readonly capabilities: readonly AiConnectorCapability[];
}

export interface AiContextConnector {
  readonly descriptor: AiConnectorDescriptor;
  getSnapshot(): AiContextSnapshot | Promise<AiContextSnapshot>;
}
