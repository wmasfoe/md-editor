// @vitest-environment jsdom
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AI_SETTINGS, LITE_LOCAL_MODEL_ID, type AiSettings } from "@md-editor/ai";
import { createEmptyStyleProfileDocument, type StyleProfileDocument } from "@md-editor/ai/style";

const disk = vi.hoisted(() => ({ profile: null as unknown }));
const invoke = vi.hoisted(() =>
  vi.fn(async (command: string, args?: { kind?: string; document?: unknown }) => {
    if (command === "load_style_learning_document") {
      return args?.kind === "profile" ? disk.profile : null;
    }
    if (command === "save_style_learning_document") {
      if (args?.kind === "profile") disk.profile = args.document;
      return 1;
    }
    return null;
  }),
);
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emit: vi.fn() }));

import { StyleLearningSettings } from "../../src/components/settings/style-learning/StyleLearningSettings";
import { useStyleLearningStore } from "../../src/app/ai/style-learning/style-learning-store";
import { useFileTreeStore } from "../../src/app/stores/file-tree-store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

function render(element: ReactElement) {
  act(() => root.render(element));
}

function settings(
  patch: Partial<AiSettings["styleLearning"]>,
  base = DEFAULT_AI_SETTINGS,
): AiSettings {
  return { ...base, styleLearning: { ...base.styleLearning, ...patch } };
}

const learnedProfile: StyleProfileDocument = {
  ...createEmptyStyleProfileDocument(),
  workspaces: [
    {
      id: "ws-1",
      rootPath: "/notes",
      linkState: "linked",
      samples: [
        {
          id: "s1",
          relPath: "a.md",
          sha256: "x",
          paragraphHashes: [],
          eligible: true,
          stats: {},
          labels: {},
        },
      ],
      rules: [
        {
          dimension: "termScript",
          value: "keep-english",
          status: "active",
          rounds: [{ round: 1, value: "keep-english", supportSampleIds: ["s1", "s2"] }],
        },
        { dimension: "formality", value: "casual", status: "draft", rounds: [] },
      ],
      editFeedback: [],
      roundCount: 3,
      changesSinceRound: 0,
    },
    {
      id: "ws-old",
      rootPath: "/old/blog",
      linkState: "unlinked",
      unlinkedSince: "2026-11-01T00:00:00Z",
      samples: [],
      rules: [],
      editFeedback: [],
      roundCount: 1,
      changesSinceRound: 0,
    },
  ],
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  invoke.mockClear();
  disk.profile = null;
  useStyleLearningStore.getState().setProfile(null);
  useFileTreeStore.setState({ folder: { rootPath: "/notes", tree: null } as never });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("style learning settings", () => {
  it("I-4: only the main switch is shown while disabled", () => {
    const onChange = vi.fn();
    render(
      createElement(StyleLearningSettings, {
        aiSettingsDraft: settings({}),
        onChangeAiSettings: onChange,
        standardModelReady: true,
        onDownloadStandardModel: vi.fn(),
      }),
    );
    const boxes = container.querySelectorAll("input[type=checkbox]");
    expect(boxes).toHaveLength(1);
    expect(container.textContent).not.toContain("自动找回");

    act(() => (boxes[0] as HTMLInputElement).click());
    expect(onChange.mock.calls[0]![0].styleLearning.enabled).toBe(true);
  });

  it("I-3: explains that learning needs the on-device Standard model", () => {
    const download = vi.fn();
    render(
      createElement(StyleLearningSettings, {
        aiSettingsDraft: settings({ enabled: true }),
        onChangeAiSettings: vi.fn(),
        standardModelReady: false,
        onDownloadStandardModel: download,
      }),
    );
    expect(container.textContent).toContain("风格学习仅支持端侧模型");
    const button = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("下载 Standard 模型"),
    )!;
    act(() => button.click());
    expect(download).toHaveBeenCalledWith("md-editor-writer-standard");
  });

  it("I-9: learned rules are read-only with sources; drafts are hidden; custom rules are editable", async () => {
    disk.profile = learnedProfile;
    useStyleLearningStore.getState().setProfile(learnedProfile);
    render(
      createElement(StyleLearningSettings, {
        aiSettingsDraft: settings({ enabled: true }),
        onChangeAiSettings: vi.fn(),
        standardModelReady: true,
        onDownloadStandardModel: vi.fn(),
      }),
    );
    const active = container.querySelector("[data-testid=style-active-rules]")!;
    expect(active.textContent).toContain("技术术语保留英文原文");
    expect(active.textContent).toContain("来源：2 篇文章");
    expect(active.querySelector("button, input, select")).toBeNull();
    expect(container.textContent).not.toContain("语气轻松");
    expect(container.textContent).toContain("/old/blog");

    const input = container.querySelector<HTMLInputElement>("input[placeholder^='例如']")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "少用感叹号。");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const add = [...container.querySelectorAll("button")].find((b) => b.textContent === "添加")!;
    await act(async () => add.click());
    // 自定义规则基于磁盘上的最新文档写入，学到的工作区画像保留。
    expect((disk.profile as typeof learnedProfile).workspaces).toHaveLength(2);
    expect(useStyleLearningStore.getState().profile?.custom).toEqual([
      expect.objectContaining({ kind: "note", text: "少用感叹号。" }),
    ]);
    expect(invoke).toHaveBeenCalledWith(
      "save_style_learning_document",
      expect.objectContaining({ kind: "profile" }),
    );
  });

  it("I-10: explains that Lite does not use writing preferences", () => {
    const lite: AiSettings = {
      ...DEFAULT_AI_SETTINGS,
      provider: "local",
      localModel: { ...DEFAULT_AI_SETTINGS.localModel, modelId: LITE_LOCAL_MODEL_ID },
    };
    render(
      createElement(StyleLearningSettings, {
        aiSettingsDraft: settings({ enabled: true }, lite),
        onChangeAiSettings: vi.fn(),
        standardModelReady: true,
        onDownloadStandardModel: vi.fn(),
      }),
    );
    expect(container.textContent).toContain("Lite 模型不使用写作偏好");
  });

  it("I-8: clearing data removes the profile but keeps the exclusion list", async () => {
    useStyleLearningStore.getState().setProfile(learnedProfile);
    render(
      createElement(StyleLearningSettings, {
        aiSettingsDraft: settings({ enabled: true }),
        onChangeAiSettings: vi.fn(),
        standardModelReady: true,
        onDownloadStandardModel: vi.fn(),
      }),
    );
    const clear = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("清除风格学习数据"),
    )!;
    await act(async () => clear.click());
    expect(invoke).toHaveBeenCalledWith("clear_style_learning_document", { kind: "profile" });
    expect(invoke).not.toHaveBeenCalledWith("clear_style_learning_document", {
      kind: "exclusions",
    });
    expect(useStyleLearningStore.getState().profile).toBeNull();
    expect(container.textContent).toContain("还没有足够的证据");
  });
});
