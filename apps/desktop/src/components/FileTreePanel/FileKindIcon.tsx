import { DocumentTextIcon, PhotoIcon } from "@heroicons/react/24/outline";
import { cx } from "../../lib/cx";

export interface FileKindIconProps {
  readonly kind: "markdown" | "asset";
}

export function FileKindIcon({ kind }: FileKindIconProps) {
  const title = kind === "markdown" ? "Markdown 文件" : "图片文件";

  return (
    <span
      className={cx(
        "file-tree-icon inline-flex h-4 w-4 flex-none items-center justify-center text-(--theme-control-subtle)",
        kind === "asset" && "text-(--theme-control-text)"
      )}
      title={title}
      aria-label={title}
    >
      {kind === "markdown" ? (
        <DocumentTextIcon className="size-[13px] stroke-[1.65]" aria-hidden="true" />
      ) : (
        <PhotoIcon className="size-[13px] stroke-[1.65]" aria-hidden="true" />
      )}
    </span>
  );
}
