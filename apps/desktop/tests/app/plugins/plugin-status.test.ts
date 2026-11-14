import { afterEach, expect, it, vi } from "vitest";
import type { PluginStatusEvent } from "../../../src/app/plugins/storage";

const events = vi.hoisted(() => ({
  listeners: new Set<(event: { payload: PluginStatusEvent }) => void>(),
  emit: vi.fn(async (_name: string, _payload: { requestId: string }) => {}),
  stop: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  emit: events.emit,
  listen: async (_name: string, listener: (event: { payload: PluginStatusEvent }) => void) => {
    events.listeners.add(listener);
    return () => {
      events.stop();
      events.listeners.delete(listener);
    };
  },
}));
import { requestPluginStatus } from "../../../src/app/plugins/storage";
const status: PluginStatusEvent = { statuses: [], keymaps: [], occupiedKeys: [] };
function deliver(payload: PluginStatusEvent) {
  for (const listener of events.listeners) listener({ payload });
}
afterEach(() => {
  events.listeners.clear();
  vi.clearAllMocks();
  vi.useRealTimers();
});
it("waits for the matching response and releases its listener", async () => {
  events.emit.mockImplementationOnce(async (_name, { requestId }) => {
    deliver({ ...status, occupiedKeys: [{ id: "stale", key: "Mod-s" }] });
    deliver({
      ...status,
      requestId: "another-window",
      occupiedKeys: [{ id: "other-window", key: "Mod-x" }],
    });
    deliver({ ...status, requestId });
  });
  expect(await requestPluginStatus()).toMatchObject(status);
  expect(events.stop).toHaveBeenCalledOnce();
  expect(events.listeners.size).toBe(0);
});
it("times out without falling back to cached status and removes its listener", async () => {
  vi.useFakeTimers();
  const result = requestPluginStatus().then(
    () => null,
    (error: unknown) => error,
  );
  await vi.waitFor(() => expect(events.emit).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(5000);
  expect(await result).toMatchObject({ message: "Plugin host did not respond" });
  expect(events.stop).toHaveBeenCalledOnce();
  expect(events.listeners.size).toBe(0);
});
it("cleans up when sending the request fails", async () => {
  events.emit.mockRejectedValueOnce(new Error("Transport failed"));
  await expect(requestPluginStatus()).rejects.toThrow("Transport failed");
  expect(events.listeners.size).toBe(0);
});
