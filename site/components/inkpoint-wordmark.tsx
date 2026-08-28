type InkpointWordmarkProps = {
  size?: "nav" | "hero";
  className?: string;
  splashesOffset?: number;
  sealOffset?: number;
};

/**
 * InkPoint 词标：书写感衬线体。
 * Point 的 o 是固定墨点（配色贴近暹罗猫，不要改外形）。
 * 水墨只作用在字母上：洇开、淡墨，hero 再加落款印与墨渍，支持视差滚动差速位移。
 */
export function InkpointWordmark({
  size = "nav",
  className,
  splashesOffset = 0,
  sealOffset = 0,
}: InkpointWordmarkProps) {
  const isHero = size === "hero";

  const mark = (
    <span
      aria-label="InkPoint"
      data-size={size}
      className={[
        "inkpoint-wordmark inline-flex items-baseline text-ink",
        isHero
          ? "text-[2.75rem] leading-none sm:text-7xl"
          : "text-[1.0625rem] leading-none sm:text-[1.125rem]",
        className ?? "",
      ].join(" ")}
    >
      <span className="ink-wash font-display font-medium tracking-[-0.04em] italic">Ink</span>
      <span className="ink-wash font-display font-semibold tracking-[-0.045em] not-italic">P</span>
      <InkBlot />
      <span className="ink-wash font-display font-semibold tracking-[-0.045em] not-italic">
        int
      </span>
    </span>
  );

  if (!isHero) {
    return mark;
  }

  return (
    <span className="relative inline-flex items-end gap-2.5 sm:gap-3.5">
      <InkSplashes offset={splashesOffset} />
      {mark}
      <InkSeal offset={sealOffset} />
    </span>
  );
}

function InkBlot() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 32 36"
      className="mx-[0.01em] h-[0.76em] w-[0.68em] shrink-0 translate-y-[0.1em] fill-blot"
    >
      {/* 略不圆的墨点，当作 Point 里的 o。外形与配色保持这一版。 */}
      <path d="M16.2 2.2c5.6.2 11.4 3.7 12.3 9.6 1.1 6.9-3.4 12.8-9.2 15.5-3.3 1.5-7.8 2.1-11.4.3C3.8 25.4 1.4 19.4 2.7 13.2 4 6.6 10.2 2 16.2 2.2Z" />
    </svg>
  );
}

function InkSeal({ offset = 0 }: { offset?: number }) {
  return (
    <span
      aria-hidden
      style={
        offset
          ? {
              transform: `translate3d(0, ${offset}px, 0)`,
              willChange: "transform",
            }
          : undefined
      }
      className="mb-0.5 inline-flex h-8 w-8 shrink-0 flex-col items-center justify-center rounded-[2px] border-[1.5px] border-seal text-[10px] leading-[1.1] font-medium tracking-[0.18em] text-seal transition-transform duration-75 ease-out sm:mb-1 sm:h-10 sm:w-10 sm:text-xs"
    >
      <span>墨</span>
      <span>点</span>
    </span>
  );
}

function InkSplashes({ offset = 0 }: { offset?: number }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 420 140"
      style={
        offset
          ? {
              transform: `translate3d(0, ${offset}px, 0)`,
              willChange: "transform",
            }
          : undefined
      }
      className="pointer-events-none absolute -inset-x-10 -top-8 -bottom-6 h-[calc(100%+4.5rem)] w-[calc(100%+5rem)] overflow-visible fill-ink/25 transition-transform duration-75 ease-out sm:-inset-x-14"
    >
      {/* 词标周围的淡墨渍，不碰到中间那滴 o。 */}
      <ellipse cx="38" cy="28" rx="18" ry="11" transform="rotate(-18 38 28)" opacity="0.22" />
      <ellipse cx="24" cy="96" rx="9" ry="6" transform="rotate(24 24 96)" opacity="0.18" />
      <circle cx="392" cy="22" r="5" opacity="0.2" />
      <ellipse cx="404" cy="108" rx="16" ry="9" transform="rotate(12 404 108)" opacity="0.16" />
      <circle cx="86" cy="124" r="3.2" opacity="0.28" />
      <circle cx="348" cy="118" r="2.4" opacity="0.22" />
    </svg>
  );
}
