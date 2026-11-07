// apps/utools/src/components/ReferralBanner.tsx
// 官网与原生桌面端导流横幅：克制、优雅、支持跳转

import { useState } from "react";
import { openOfficialSite } from "../utools/referral";
import { CloseIcon, ExternalLinkIcon } from "./Icons";

export function ReferralBanner() {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) {
    return null;
  }

  return (
    <aside
      className="flex items-center justify-between px-3 py-1.5 bg-[var(--theme-primary-soft)] border-b border-[var(--theme-border)] text-xs text-[var(--theme-text)] select-none shrink-0"
      aria-label="桌面版功能推介"
    >
      <div className="flex items-center gap-2 truncate">
        <span className="text-[var(--theme-title)] font-medium shrink-0">Inkpoint 桌面版</span>
        <span className="text-[var(--theme-muted)] truncate">
          多窗口、本地离线模型、系统原生菜单
        </span>
      </div>

      <div className="flex items-center gap-2.5 shrink-0 ml-2">
        <button
          type="button"
          onClick={() => openOfficialSite("top_banner")}
          className="inline-flex items-center gap-1 font-medium text-[var(--theme-primary)] hover:underline cursor-pointer bg-transparent border-0 p-0"
        >
          <span>前往官网</span>
          <ExternalLinkIcon className="size-3" />
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-[var(--theme-muted)] hover:text-[var(--theme-text)] cursor-pointer bg-transparent border-0 p-0.5 rounded hover:bg-[var(--theme-control-hover)] flex items-center justify-center"
          title="临时隐藏"
          aria-label="关闭导流横幅"
        >
          <CloseIcon className="size-3.5" />
        </button>
      </div>
    </aside>
  );
}
