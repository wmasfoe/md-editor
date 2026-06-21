import { describe, expect, it, vi } from "vitest";
import { bindRecentFileMenuEvents } from "../src/app/events/recent-file-events";

describe("recent-file menu events", () => {
  it("opens the authoritative native entry selected by menu index", async () => {
    const target = new EventTarget();
    const openRecentFile = vi.fn(async () => undefined);
    const dispose = bindRecentFileMenuEvents({
      target,
      store: {
        listAuthoritative: async () => [
          { path: "/notes/first.md", name: "first.md", lastOpenedAt: 2 },
          { path: "/notes/second.md", name: "second.md", lastOpenedAt: 1 }
        ],
        clear: async () => undefined
      },
      openRecentFile
    });

    const event = new Event("open-recent-file-by-index") as Event & { detail: { index: number } };
    event.detail = { index: 1 };
    target.dispatchEvent(event);
    await Promise.resolve();
    await Promise.resolve();

    expect(openRecentFile).toHaveBeenCalledWith("/notes/second.md");
    dispose();
  });

  it("clears both stores and reports asynchronous failures", async () => {
    const target = new EventTarget();
    const clear = vi.fn(async () => {
      throw new Error("clear failed");
    });
    const onError = vi.fn();
    const dispose = bindRecentFileMenuEvents({
      target,
      store: { listAuthoritative: async () => [], clear },
      openRecentFile: async () => undefined,
      onError
    });

    target.dispatchEvent(new Event("clear-recent-files"));
    await Promise.resolve();
    await Promise.resolve();

    expect(clear).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith("clear failed");
    dispose();
  });
});
