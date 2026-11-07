"use client";

import type { ReactNode } from "react";

interface SatelliteBadgeProps {
  href: string;
  /** 线性图标（16–20px），颜色继承 iconClassName 所在容器的文字色 */
  icon: ReactNode;
  iconClassName: string;
  title: string;
  description: string;
  rotate: number;
  translateY: number;
  translateZ?: number;
  className: string;
  /** 默认 md 起展示；左下挂件沿用原契约，仅 lg 起展示以免与舞台重叠 */
  visibleFrom?: "md" | "lg";
}

/**
 * 编辑器舞台四周的浮动视差挂件。
 * 视觉契约与原 satellite badge 一致：磨砂纸面、内嵌高光、微旋转；点击平滑跳到对应钉住区块。
 */
export function SatelliteBadge({
  href,
  icon,
  iconClassName,
  title,
  description,
  rotate,
  translateY,
  translateZ = 64,
  className,
  visibleFrom = "md",
}: SatelliteBadgeProps) {
  const visibilityClass =
    visibleFrom === "lg"
      ? "hidden lg:flex lg:items-center lg:gap-2.5"
      : "hidden md:flex md:items-center md:gap-2.5";

  return (
    <a
      href={href}
      style={{
        transform: `translate3d(0, ${translateY}px, ${translateZ}px) rotate(${rotate}deg)`,
        willChange: "transform",
      }}
      className={[
        "absolute z-30 rounded-xl border border-line-strong/80 bg-surface px-4 py-2.5 shadow-[0_8px_24px_rgba(20,18,15,0.08),inset_0_1px_0_rgba(255,255,255,0.9)] transition-[box-shadow,background-color] duration-200",
        visibilityClass,
        "hover:bg-surface hover:shadow-[0_12px_28px_rgba(20,18,15,0.12)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        className,
      ].join(" ")}
      aria-label={`${title}，${description}`}
    >
      <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${iconClassName}`}>
        {icon}
      </span>
      <div>
        <p className="text-xs font-medium text-ink">{title}</p>
        <p className="text-[11px] text-muted">{description}</p>
      </div>
    </a>
  );
}
