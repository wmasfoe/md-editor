import { expect, it, vi } from "vitest";
import { promotePendingPlugins } from "../../../src/app/plugins/promote-pending";
import type { StoredPlugin } from "../../../src/app/plugins/storage";

it("promotes only queued versions and leaves all versions untouched in safe start", async () => {
  const first = {
    id: "a.one",
    current: { source: { tag: "v1" } },
    pending: { source: { tag: "v2" } },
    previous: null,
    enabled: true,
    settings: { value: true },
  } as unknown as StoredPlugin;
  const second = { ...first, id: "a.two", pending: null };
  const save = vi.fn(async () => {});
  await promotePendingPlugins([first, second], true, save);
  expect(save).not.toHaveBeenCalled();
  await promotePendingPlugins([first, second], false, save);
  expect(save).toHaveBeenCalledOnce();
  expect(save).toHaveBeenCalledWith({
    ...first,
    previous: first.current,
    current: first.pending,
    pending: null,
  });
});
