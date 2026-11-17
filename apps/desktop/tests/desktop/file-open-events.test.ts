import { beforeEach, describe, expect, it, vi } from "vitest";
import { FILE_OPEN_EVENT, listenToDesktopFileOpens } from "../../src/desktop/file-open-events";

const tauri = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  invoke: vi.fn(),
  listen: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: tauri.isTauri, invoke: tauri.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: tauri.listen }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function settle() {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

describe("desktop OS file open requests", () => {
  let notify: () => void;
  let queue: string[];
  let unlisten: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    tauri.isTauri.mockReturnValue(true);
    queue = [];
    unlisten = vi.fn();
    tauri.invoke.mockImplementation(async () => queue.shift() ?? null);
    tauri.listen.mockImplementation(async (_name, handler) => {
      notify = handler;
      return unlisten;
    });
  });

  it("opens cold-start requests only after the live listener is registered", async () => {
    const registration = deferred<() => void>();
    tauri.listen.mockReturnValue(registration.promise);
    queue.push("/notes/中文 #1.md");
    const open = vi.fn(async () => undefined);
    const dispose = listenToDesktopFileOpens(open, vi.fn());
    await settle();
    expect(tauri.invoke).not.toHaveBeenCalled();

    registration.resolve(unlisten);
    await settle();
    expect(tauri.listen).toHaveBeenCalledWith(FILE_OPEN_EVENT, expect.any(Function));
    expect(tauri.invoke).toHaveBeenCalledWith("take_pending_file_open");
    expect(open.mock.calls).toEqual([["/notes/中文 #1.md"]]);
    dispose?.();
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("opens later double clicks and serializes requests while an open action is pending", async () => {
    const confirmation = deferred<void>();
    const open = vi
      .fn()
      .mockImplementationOnce(() => confirmation.promise)
      .mockResolvedValue(undefined);
    const dispose = listenToDesktopFileOpens(open, vi.fn());
    await settle();

    queue.push("/first.md");
    notify();
    await settle();
    queue.push("/second.markdown");
    notify();
    notify();
    await settle();
    expect(open.mock.calls).toEqual([["/first.md"]]);

    confirmation.resolve();
    await settle();
    expect(open.mock.calls).toEqual([["/first.md"], ["/second.markdown"]]);
    dispose?.();
  });

  it("rechecks the queue if a notification arrives during the final empty read", async () => {
    const emptyRead = deferred<string | null>();
    tauri.invoke.mockImplementationOnce(() => emptyRead.promise);
    const open = vi.fn(async () => undefined);
    const dispose = listenToDesktopFileOpens(open, vi.fn());
    await settle();
    queue.push("/arrived-during-read.md");
    notify();
    emptyRead.resolve(null);
    await settle();
    expect(open.mock.calls).toEqual([["/arrived-during-read.md"]]);
    dispose?.();
  });

  it("reports an open failure and still processes the next request", async () => {
    queue.push("/missing.md", "/readable.md");
    const error = new Error("File does not exist");
    const open = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined);
    const onError = vi.fn();
    const dispose = listenToDesktopFileOpens(open, onError);
    await settle();
    expect(onError.mock.calls).toEqual([[error]]);
    expect(open.mock.calls).toEqual([["/missing.md"], ["/readable.md"]]);
    dispose?.();
  });

  it("does not consume startup files during a StrictMode setup/cleanup replay", async () => {
    const registration = deferred<() => void>();
    tauri.listen.mockReturnValueOnce(registration.promise);
    queue.push("/retained.md");
    const open = vi.fn(async () => undefined);
    const firstDispose = listenToDesktopFileOpens(open, vi.fn());
    firstDispose?.();
    const lateUnlisten = vi.fn();
    registration.resolve(lateUnlisten);
    await settle();
    expect(lateUnlisten).toHaveBeenCalledOnce();
    expect(tauri.invoke).not.toHaveBeenCalled();

    const dispose = listenToDesktopFileOpens(open, vi.fn());
    await settle();
    expect(open.mock.calls).toEqual([["/retained.md"]]);
    dispose?.();
  });

  it("reports listener registration failure without consuming files", async () => {
    const error = new Error("IPC unavailable");
    tauri.listen.mockRejectedValue(error);
    const onError = vi.fn();
    const dispose = listenToDesktopFileOpens(vi.fn(), onError);
    await settle();
    expect(onError).toHaveBeenCalledWith(error);
    expect(tauri.invoke).not.toHaveBeenCalled();
    dispose?.();
  });

  it("reports a queue read failure and retries retained requests on the next notification", async () => {
    const error = new Error("IPC read failed");
    tauri.invoke.mockRejectedValueOnce(error);
    queue.push("/retained-after-ipc-error.md");
    const open = vi.fn(async () => undefined);
    const onError = vi.fn();
    const dispose = listenToDesktopFileOpens(open, onError);
    await settle();
    expect(onError.mock.calls).toEqual([[error]]);
    expect(open).not.toHaveBeenCalled();

    notify();
    await settle();
    expect(open.mock.calls).toEqual([["/retained-after-ipc-error.md"]]);
    dispose?.();
  });

  it("does not consume another request after disposal while an open action is pending", async () => {
    const pendingOpen = deferred<void>();
    const open = vi.fn(() => pendingOpen.promise);
    queue.push("/first.md", "/still-queued.md");
    const dispose = listenToDesktopFileOpens(open, vi.fn());
    await settle();
    dispose?.();
    pendingOpen.resolve();
    // A late native callback must also be harmless after listener cleanup.
    notify();
    await settle();
    expect(open.mock.calls).toEqual([["/first.md"]]);
    expect(queue).toEqual(["/still-queued.md"]);
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("does not register native listeners in a browser preview", () => {
    tauri.isTauri.mockReturnValue(false);
    expect(listenToDesktopFileOpens(vi.fn(), vi.fn())).toBeUndefined();
    expect(tauri.listen).not.toHaveBeenCalled();
  });
});
