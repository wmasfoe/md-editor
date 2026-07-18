import {
  createRuntimeFileService,
  type FileSaveSchedulerOptions,
  type FileServiceAdapter,
  type MarkdownDocumentFile,
  type MarkdownFolder,
  type NativeFileSaveJob,
  type NativeSaveAdapter,
  type NativeSaveRuntimeRegistration,
  type RuntimeFileService,
} from "@md-editor/file-system";

const EPOCH_STORAGE_KEY = "md-editor:e2e:save-runtime-epoch";
const DEFAULT_FIXTURE_PATH = "/fixtures/s1-scroll.md";

const files = new Map<string, string>([
  [
    DEFAULT_FIXTURE_PATH,
    Array.from({ length: 120 }, (_, index) => `## Section ${index + 1}\n\nLine ${index + 1}.`)
      .join("\n\n")
      .concat("\n"),
  ],
  ["/fixtures/same-a.md", "# Identical\n"],
  ["/fixtures/same-b.md", "# Identical\n"],
  [
    "/fixtures/m1-s2-media.md",
    [
      "# Media",
      "",
      'Before [label](https://example.com "title") after.',
      "",
      '![failed preview](missing-image.png "Caption")',
      "",
      "---",
      "",
      "Setext visual",
      "=============",
      "",
      "Default <https://explicit.example> and https://bare.example/path.",
      "",
      "[reference label][ref]",
      "",
      '[ref]: https://reference.example "Reference"',
      "",
      "[^note]",
      "",
      "[^note]: Footnote body",
      "",
      "```md",
      "https://raw.example [^raw]",
      "```",
      "",
      "| value |",
      "| --- |",
      "| [^table] |",
      "",
      "<div>[^html]</div>",
      "",
      '<Component value="[^mdx]" />',
      "",
      "Tail",
      "",
    ].join("\n"),
  ],
  [
    "/fixtures/m1-frontmatter.md",
    [
      "---",
      "# exact source comment",
      'title: "Exact title"',
      "defaults: &defaults enabled",
      "copy: *defaults",
      "---",
      "# Body",
      "",
      "<div>HTML stays raw</div>",
      "",
      '<Component value="MDX stays raw" />',
      "",
    ].join("\n"),
  ],
]);

let attachCount = 0;
let factoryCount = 0;
let nativeSaveCount = 0;
let activeNativeJobs = 0;
let maxConcurrentNativeJobs = 0;
let currentRegistration: NativeSaveRuntimeRegistration | null = null;
let folderEmpty = false;
const saveBehaviors: E2eSaveBehavior[] = [];
const saveLog: E2eSaveLogEntry[] = [];

export interface E2eSaveBehavior {
  readonly status: "success" | "warning" | "failure" | "cancel" | "indeterminate";
  readonly actualPath?: string;
  readonly delayMs?: number;
}

export interface E2eSaveLogEntry {
  readonly checkpointSequence: number;
  readonly filePath: string | null;
  readonly markdownLf: string;
  readonly runtimeSequence: number;
  readonly status: E2eSaveBehavior["status"];
}

export interface E2ePlatformDiagnostics {
  readonly attachCount: number;
  readonly factoryCount: number;
  readonly nativeSaveCount: number;
  readonly maxConcurrentNativeJobs: number;
  readonly registration: NativeSaveRuntimeRegistration | null;
  readonly saveLog: readonly E2eSaveLogEntry[];
}

export function attachE2eSaveRuntime(): Promise<NativeSaveRuntimeRegistration> {
  attachCount += 1;
  const previousEpoch = Number.parseInt(localStorage.getItem(EPOCH_STORAGE_KEY) ?? "0", 10);
  const epoch = Number.isSafeInteger(previousEpoch) && previousEpoch >= 0 ? previousEpoch + 1 : 1;
  localStorage.setItem(EPOCH_STORAGE_KEY, String(epoch));
  currentRegistration = Object.freeze({ epoch, id: epoch, sequenceSeed: 0 });
  return Promise.resolve(currentRegistration);
}

export function createE2eRuntimeFileService(
  registration: NativeSaveRuntimeRegistration,
  options?: FileSaveSchedulerOptions,
): RuntimeFileService {
  factoryCount += 1;
  return createRuntimeFileService(
    createE2eFileAdapter(),
    createE2eNativeSaveAdapter(),
    registration,
    options,
  );
}

export function getE2ePlatformDiagnostics(): E2ePlatformDiagnostics {
  return Object.freeze({
    attachCount,
    factoryCount,
    nativeSaveCount,
    maxConcurrentNativeJobs,
    registration: currentRegistration,
    saveLog: Object.freeze([...saveLog]),
  });
}

export function enqueueE2eSaveBehavior(behavior: E2eSaveBehavior): void {
  saveBehaviors.push(Object.freeze({ ...behavior }));
}

export function setE2eFolderEmpty(empty: boolean): void {
  folderEmpty = empty;
}

export function readE2eMarkdown(path: string): string | null {
  return files.get(path) ?? null;
}

function createE2eFileAdapter(): FileServiceAdapter {
  return {
    async openMarkdownFile() {
      return documentAt(DEFAULT_FIXTURE_PATH);
    },
    async openMarkdownFolder() {
      return fixtureFolder();
    },
    async readMarkdownFile(path) {
      const document = documentAt(path);
      if (!document) {
        throw new Error(`Fixture does not exist: ${path}`);
      }
      return document;
    },
    async refreshMarkdownFolder() {
      return fixtureFolder();
    },
    async createMarkdownTreeItem(input) {
      const extension = input.kind === "markdown" && !/\.mdx?$/u.test(input.name) ? ".md" : "";
      const path = `${input.parentPath}/${input.name}${extension}`.replace(/\/+/gu, "/");
      if (input.kind === "markdown") {
        files.set(path, "");
      }
      return { folder: fixtureFolder(), affectedPath: path };
    },
    async renameMarkdownTreeItem(input) {
      const nextPath = `${input.path.slice(0, input.path.lastIndexOf("/"))}/${input.name}`;
      const markdown = files.get(input.path);
      if (markdown !== undefined) {
        files.delete(input.path);
        files.set(nextPath, markdown);
      }
      return { folder: fixtureFolder(), affectedPath: nextPath };
    },
    async deleteMarkdownTreeItem(input) {
      files.delete(input.path);
      return { folder: fixtureFolder(), affectedPath: null };
    },
  };
}

function createE2eNativeSaveAdapter(): NativeSaveAdapter {
  return {
    async saveMarkdownJob(job: NativeFileSaveJob) {
      activeNativeJobs += 1;
      maxConcurrentNativeJobs = Math.max(maxConcurrentNativeJobs, activeNativeJobs);
      nativeSaveCount += 1;
      try {
        const behavior = saveBehaviors.shift() ?? { status: "success" as const };
        if (behavior.delayMs && behavior.delayMs > 0) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, behavior.delayMs));
        }
        const path =
          behavior.actualPath ??
          (job.destination.kind === "current-path"
            ? job.destination.path
            : (job.destination.suggestedPath ??
              `/fixtures/saved-${job.orderingToken.runtimeSequence}.md`));
        saveLog.push(
          Object.freeze({
            checkpointSequence: job.checkpointSequence,
            filePath: behavior.status === "success" || behavior.status === "warning" ? path : null,
            markdownLf: job.markdownLf,
            runtimeSequence: job.orderingToken.runtimeSequence,
            status: behavior.status,
          }),
        );

        if (behavior.status === "failure") {
          return {
            status: "not-committed",
            disposition: "failed",
            runtimeSequence: job.orderingToken.runtimeSequence,
            phase: "rename",
            errorCode: "e2e-rename-failed",
          };
        }
        if (behavior.status === "cancel") {
          return {
            status: "not-committed",
            disposition: "cancelled",
            runtimeSequence: job.orderingToken.runtimeSequence,
            phase: "dialog",
          };
        }
        if (behavior.status === "indeterminate") {
          return {
            status: "indeterminate",
            runtimeSequence: job.orderingToken.runtimeSequence,
            errorCode: "e2e-transport-unknown",
          };
        }

        files.set(path, job.markdownLf);
        return {
          status: "committed",
          runtimeSequence: job.orderingToken.runtimeSequence,
          filePath: path,
          warnings:
            behavior.status === "warning"
              ? [
                  {
                    code: "asset-directory-registration-failed",
                    message: "E2E asset registration warning",
                  },
                ]
              : [],
        };
      } finally {
        activeNativeJobs -= 1;
      }
    },
  };
}

function documentAt(path: string): MarkdownDocumentFile | null {
  const markdown = files.get(path);
  return markdown === undefined ? null : { filePath: path, markdown };
}

function fixtureFolder(): MarkdownFolder {
  // ES2022 target: sorting this fresh array is local and cannot mutate fixture state.
  // oxlint-disable-next-line unicorn/no-array-sort
  const sortedPaths = [...files.keys()].sort();
  const children = folderEmpty
    ? []
    : sortedPaths.map((path) => ({
        kind: "markdown" as const,
        name: path.split("/").pop() ?? path,
        path,
      }));
  return {
    rootPath: "/fixtures",
    rootName: "fixtures",
    tree: { kind: "directory", name: "fixtures", path: "/fixtures", children },
  };
}
