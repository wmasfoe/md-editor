import type { EditorSnapshot, NativeCommand } from "./protocol.ts";

declare global {
  interface Window {
    ipc?: { postMessage(message: string): void };
    inkpointReceive?: (command: NativeCommand) => void;
    inkpointSnapshot?: () => EditorSnapshot;
  }
}
