// apps/utools/src/components/DisclaimerModal.tsx
// AI API Key 安全免责与风险告知弹窗

import { AI_DISCLAIMER_CONTENT, acceptAiDisclaimer } from "../utools/ai-disclaimer";
import { openOfficialSite } from "../utools/referral";

export interface DisclaimerModalProps {
  isOpen: boolean;
  onAccept: () => void;
  onClose: () => void;
}

export function DisclaimerModal({ isOpen, onAccept, onClose }: DisclaimerModalProps) {
  if (!isOpen) {
    return null;
  }

  const handleConfirm = () => {
    acceptAiDisclaimer();
    onAccept();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="disclaimer-title"
    >
      <div className="max-w-md w-full rounded-lg bg-[var(--theme-surface)] border border-[var(--theme-border)] shadow-xl p-5 text-sm text-[var(--theme-text)]">
        <h2
          id="disclaimer-title"
          className="text-base font-semibold text-[var(--theme-title)] mb-3"
        >
          {AI_DISCLAIMER_CONTENT.title}
        </h2>

        <p className="text-xs leading-relaxed text-[var(--theme-muted)] mb-3">
          {AI_DISCLAIMER_CONTENT.summary}
        </p>

        <div className="space-y-2 mb-4 bg-[var(--theme-bg-muted)] p-3 rounded border border-[var(--theme-border)] text-xs text-[var(--theme-muted)]">
          {AI_DISCLAIMER_CONTENT.points.map((point) => (
            <p key={point} className="leading-snug">
              {point}
            </p>
          ))}
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={handleConfirm}
            className="w-full py-2 px-3 rounded bg-[var(--theme-primary)] text-white font-medium text-xs hover:opacity-90 cursor-pointer border-0"
          >
            {AI_DISCLAIMER_CONTENT.buttonAccept}
          </button>

          <button
            type="button"
            onClick={() => openOfficialSite("ai_disclaimer")}
            className="w-full py-2 px-3 rounded bg-[var(--theme-control-active)] text-[var(--theme-primary)] font-medium text-xs hover:bg-[var(--theme-control-hover)] cursor-pointer border-0"
          >
            {AI_DISCLAIMER_CONTENT.buttonDownloadDesktop} ↗
          </button>

          <button
            type="button"
            onClick={onClose}
            className="w-full py-1.5 px-3 rounded text-xs text-[var(--theme-muted)] hover:text-[var(--theme-text)] cursor-pointer bg-transparent border-0"
          >
            {AI_DISCLAIMER_CONTENT.buttonReject}
          </button>
        </div>
      </div>
    </div>
  );
}
