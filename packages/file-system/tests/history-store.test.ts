import { describe, expect, it } from "vitest";
import {
  calculateContentHash,
  createHistoryStore,
  createMemoryHistoryStorageAdapter,
} from "../src/history/index.ts";

describe("HistoryStore (文档历史版本快照管理)", () => {
  it("calculateContentHash 能产生确定性指纹，内容微调产生不同散列", () => {
    const textA = "# Document Title\n\nSome body text.";
    const textB = "# Document Title\n\nSome body text.";
    const textC = "# Document Title\n\nSome body text.!";

    expect(calculateContentHash(textA)).toBe(calculateContentHash(textB));
    expect(calculateContentHash(textA)).not.toBe(calculateContentHash(textC));
  });

  it("记录快照并读取，相同内容自动去重（不重复记录）", async () => {
    const adapter = createMemoryHistoryStorageAdapter();
    const store = createHistoryStore(adapter);

    const docPath = "/projects/my-doc.md";
    const v1 = "# First Version";
    const v2 = "# Second Version";

    const entry1 = await store.recordSnapshot(docPath, v1, "manual-save");
    expect(entry1).not.toBeNull();
    expect(entry1?.charCount).toBe(v1.length);
    expect(entry1?.lineCount).toBe(1);

    // 相同内容再次尝试记录 -> 返回 null (去重)
    const duplicate = await store.recordSnapshot(docPath, v1, "manual-save");
    expect(duplicate).toBeNull();

    // 内容改变后记录
    const entry2 = await store.recordSnapshot(docPath, v2, "auto-idle");
    expect(entry2).not.toBeNull();

    const list = await store.listSnapshots(docPath);
    expect(list.length).toBe(2);
    expect(list[0].id).toBe(entry1?.id);
    expect(list[1].id).toBe(entry2?.id);

    // 能读出对应的完整快照内容
    const content1 = await store.loadSnapshotContent(docPath, entry1!.id);
    const content2 = await store.loadSnapshotContent(docPath, entry2!.id);
    expect(content1).toBe(v1);
    expect(content2).toBe(v2);
  });

  it("能单独删除单条快照或清空文档全部历史", async () => {
    const adapter = createMemoryHistoryStorageAdapter();
    const store = createHistoryStore(adapter);

    const docPath = "/doc.md";
    const entry1 = await store.recordSnapshot(docPath, "v1", "manual-save");
    const entry2 = await store.recordSnapshot(docPath, "v2", "manual-save");

    expect((await store.listSnapshots(docPath)).length).toBe(2);

    await store.deleteSnapshot(docPath, entry1!.id);
    const listAfterDelete = await store.listSnapshots(docPath);
    expect(listAfterDelete.length).toBe(1);
    expect(listAfterDelete[0].id).toBe(entry2!.id);

    await store.clearHistory(docPath);
    expect((await store.listSnapshots(docPath)).length).toBe(0);
  });

  it("超过上限时自动淘汰最老快照", async () => {
    const adapter = createMemoryHistoryStorageAdapter();
    const store = createHistoryStore(adapter, { maxEntries: 3 });

    const docPath = "/doc.md";
    await store.recordSnapshot(docPath, "v1", "manual-save");
    await store.recordSnapshot(docPath, "v2", "manual-save");
    await store.recordSnapshot(docPath, "v3", "manual-save");
    await store.recordSnapshot(docPath, "v4", "manual-save");

    const list = await store.listSnapshots(docPath);
    expect(list.length).toBe(3);
    expect(list.map((e) => e.charCount)).toEqual([2, 2, 2]);
  });
});
