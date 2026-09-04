// apps/utools/src/components/ReferralBanner.tsx
// 官网与原生桌面端导流横幅：克制、优雅、支持跳转

import { useState } from "react";
import { openOfficialSite } from "../utools/referral";

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
      <div className="flex items-center gap-1.5 truncate">
        <span className="text-[var(--theme-primary)] font-medium">💡 Inkpoint 桌面版已发布：</span>
        <span className="text-[var(--theme-muted)] truncate">
          支持无限制多窗口、完整工作区侧栏及独家【本地专属微调小模型】（零数据外传）
        </span>
      </div>

      <div className="flex items-center gap-2 shrink-0 ml-2">
        <button
          type="button"
          onClick={() => openOfficialSite("top_banner")}
          className="inline-flex items-center gap-1 font-medium text-[var(--theme-primary)] hover:underline cursor-pointer bg-transparent border-0 p-0"
        >
          前往官网获取 ↗
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-[var(--theme-muted)] hover:text-[var(--theme-text)] cursor-pointer bg-transparent border-0 p-0 ml-1 text-sm leading-none"
          title="临时隐藏"
          aria-label="关闭导流横幅"
        >
          ×
        </button>
      </div>
    </aside>
  );
}
