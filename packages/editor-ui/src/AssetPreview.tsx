import { useEffect, useMemo, useState } from "react";

export interface AssetPreviewInput {
  readonly name: string;
  readonly path: string;
}

export interface AssetPreviewProps {
  readonly asset: AssetPreviewInput;
  readonly resolveAssetSrc?: (path: string) => string;
}

export function AssetPreview({ asset, resolveAssetSrc = (path) => path }: AssetPreviewProps) {
  const [failedPath, setFailedPath] = useState<string | null>(null);
  const assetUrl = useMemo(() => resolveAssetSrc(asset.path), [asset.path, resolveAssetSrc]);

  useEffect(() => {
    setFailedPath(null);
  }, [asset.path]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--theme-surface)]">
      <div
        className="min-h-[34px] overflow-hidden border-b border-[var(--theme-border)] bg-[var(--theme-chrome)] px-5 py-1.5 text-[13px] font-semibold leading-[1.35] text-ellipsis whitespace-nowrap text-[var(--theme-control-text)]"
        title={asset.path}
      >
        {asset.name}
      </div>
      <div className="grid min-h-0 flex-1 place-items-center overflow-auto p-7">
        {failedPath ? (
          <div className="grid max-w-[min(520px,100%)] gap-2 rounded border border-[rgba(227,15,46,0.18)] bg-[var(--theme-danger-bg)] px-4 py-3.5 text-[13px] leading-[1.45] text-[var(--theme-danger-text)]">
            <strong>图片加载失败</strong>
            <span className="overflow-anywhere font-mono text-[var(--theme-control-text)]">
              {failedPath}
            </span>
          </div>
        ) : (
          <img
            className="max-h-full max-w-full object-contain"
            src={assetUrl}
            alt={asset.name}
            onError={() => setFailedPath(asset.path)}
          />
        )}
      </div>
    </div>
  );
}
