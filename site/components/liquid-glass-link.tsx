"use client";

import dynamic from "next/dynamic";
import {
  createContext,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

// 库在 render 期读 navigator；仅客户端挂载，避免 SSR/预渲染崩溃。
const LiquidGlassSurface = dynamic(() => import("liquid-glass-react"), {
  ssr: false,
  loading: () => <span className="site-liquid-surface__fallback" aria-hidden />,
});

type LiquidGlassTone = "nav" | "primary" | "secondary";

type LiquidGlassProps = {
  href: string;
  children: ReactNode;
  /** nav：顶栏；primary：主 CTA；secondary：次 CTA */
  tone?: LiquidGlassTone;
  className?: string;
  external?: boolean;
  download?: string | boolean;
};

type LiquidGlassGroupProps = {
  children: ReactNode;
  className?: string;
};

type PointerPosition = {
  globalX: number;
  globalY: number;
  offsetX: number;
  offsetY: number;
  isActive: boolean;
};

type GroupSurface = PointerPosition & {
  memberId: string;
  tone: LiquidGlassTone;
  left: number;
  top: number;
  width: number;
  height: number;
  frameWidth: number;
  frameHeight: number;
};

type LiquidGlassGroupContextValue = {
  registerMember: (memberId: string, element: HTMLAnchorElement | null) => void;
  activateMember: (
    memberId: string,
    tone: LiquidGlassTone,
    event: PointerEvent<HTMLAnchorElement>,
  ) => void;
  resetSurface: () => void;
};

const LiquidGlassGroupContext = createContext<LiquidGlassGroupContextValue | null>(null);

const restingPointerPosition: PointerPosition = {
  globalX: 0,
  globalY: 0,
  offsetX: 0,
  offsetY: 0,
  isActive: false,
};

/** 各 tone 的折射参数；位移与色差保持克制，避免明显彩边和漂移。 */
const toneConfig = {
  nav: {
    displacementScale: 24,
    blurAmount: 0.045,
    saturation: 118,
    aberrationIntensity: 0.45,
    elasticity: 0.1,
    cornerRadius: 999,
    padding: "10px 14px",
    overLight: false,
  },
  primary: {
    displacementScale: 34,
    blurAmount: 0.06,
    saturation: 124,
    aberrationIntensity: 0.7,
    elasticity: 0.16,
    cornerRadius: 999,
    padding: "12px 24px",
    overLight: false,
  },
  secondary: {
    displacementScale: 28,
    blurAmount: 0.05,
    saturation: 118,
    aberrationIntensity: 0.55,
    elasticity: 0.13,
    cornerRadius: 999,
    padding: "12px 22px",
    overLight: false,
  },
} as const;

function getPointerPosition(
  event: PointerEvent<HTMLAnchorElement>,
  bounds: DOMRect,
): PointerPosition {
  const normalizedX = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
  const normalizedY = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height));

  return {
    globalX: event.clientX,
    globalY: event.clientY,
    // liquid-glass-react 的鼠标偏移语义是以中心为 0 的百分比。
    offsetX: (normalizedX - 0.5) * 100,
    offsetY: (normalizedY - 0.5) * 100,
    isActive: true,
  };
}

function getPointerStyle(pointerPosition: PointerPosition): CSSProperties {
  return {
    "--site-liquid-pointer-x": `${50 + pointerPosition.offsetX}%`,
    "--site-liquid-pointer-y": `${50 + pointerPosition.offsetY}%`,
    "--site-liquid-pointer-light": pointerPosition.isActive
      ? "rgb(255 255 255 / 0.15)"
      : "rgb(255 255 255 / 0)",
  } as CSSProperties;
}

function getGroupFrameSize(members: Map<string, HTMLAnchorElement>) {
  let width = 0;
  let height = 0;

  for (const member of members.values()) {
    const bounds = member.getBoundingClientRect();
    width = Math.max(width, bounds.width);
    height = Math.max(height, bounds.height);
  }

  return { width, height };
}

function useFinePointerCapability(onDisabled: () => void) {
  const [canTrackPointer, setCanTrackPointer] = useState(false);

  useEffect(() => {
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const fineHoverQuery = window.matchMedia("(any-hover: hover) and (any-pointer: fine)");

    const updatePointerCapability = () => {
      const canTrack = fineHoverQuery.matches && !motionQuery.matches;
      setCanTrackPointer(canTrack);

      if (!canTrack) {
        onDisabled();
      }
    };

    updatePointerCapability();
    motionQuery.addEventListener("change", updatePointerCapability);
    fineHoverQuery.addEventListener("change", updatePointerCapability);

    return () => {
      motionQuery.removeEventListener("change", updatePointerCapability);
      fineHoverQuery.removeEventListener("change", updatePointerCapability);
    };
  }, [onDisabled]);

  return canTrackPointer;
}

/**
 * 共享一块玻璃视觉层的容器。
 *
 * 组内每个 LiquidGlass 仍是独立原生链接；只有视觉层在成员之间移动，
 * 因而下载、外链、焦点和命中区域都不随动画改变。
 */
export function LiquidGlassGroup({ children, className = "" }: LiquidGlassGroupProps) {
  const groupRef = useRef<HTMLDivElement | null>(null);
  const membersRef = useRef(new Map<string, HTMLAnchorElement>());
  const animationFrameRef = useRef<number | null>(null);
  const surfaceRef = useRef<GroupSurface | null>(null);
  const nextSurfaceRef = useRef<GroupSurface | null>(null);
  const [surface, setSurface] = useState<GroupSurface | null>(null);

  const scheduleSurface = useCallback((nextSurface: GroupSurface) => {
    surfaceRef.current = nextSurface;
    nextSurfaceRef.current = nextSurface;

    if (animationFrameRef.current !== null) {
      return;
    }

    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null;
      setSurface(nextSurfaceRef.current);
    });
  }, []);

  const resetSurface = useCallback(() => {
    const currentSurface = surfaceRef.current;

    if (!currentSurface) {
      return;
    }

    scheduleSurface({ ...currentSurface, ...restingPointerPosition });
  }, [scheduleSurface]);

  const canTrackPointer = useFinePointerCapability(resetSurface);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  const registerMember = useCallback((memberId: string, element: HTMLAnchorElement | null) => {
    if (element) {
      membersRef.current.set(memberId, element);
      return;
    }

    membersRef.current.delete(memberId);
  }, []);

  const activateMember = useCallback(
    (memberId: string, tone: LiquidGlassTone, event: PointerEvent<HTMLAnchorElement>) => {
      if (!canTrackPointer || event.pointerType !== "mouse") {
        return;
      }

      const group = groupRef.current;
      const member = membersRef.current.get(memberId);

      if (!group || !member) {
        return;
      }

      const groupBounds = group.getBoundingClientRect();
      const memberBounds = member.getBoundingClientRect();
      const frame = getGroupFrameSize(membersRef.current);

      scheduleSurface({
        memberId,
        tone,
        left: memberBounds.left - groupBounds.left,
        top: memberBounds.top - groupBounds.top,
        width: memberBounds.width,
        height: memberBounds.height,
        frameWidth: Math.max(memberBounds.width, frame.width),
        frameHeight: Math.max(memberBounds.height, frame.height),
        ...getPointerPosition(event, memberBounds),
      });
    },
    [canTrackPointer, scheduleSurface],
  );

  // 指针每帧只更新共享表面，避免 Context 值随 surface state 改变而重渲染所有成员。
  const contextValue = useMemo(
    () => ({
      registerMember,
      activateMember,
      resetSurface,
    }),
    [activateMember, registerMember, resetSurface],
  );

  return (
    <LiquidGlassGroupContext.Provider value={contextValue}>
      <div
        ref={groupRef}
        className={["site-liquid-group", className].filter(Boolean).join(" ")}
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse") {
            resetSurface();
          }
        }}
        onPointerCancel={resetSurface}
      >
        {children}
        {surface ? <GroupedLiquidGlassSurface surface={surface} /> : null}
      </div>
    </LiquidGlassGroupContext.Provider>
  );
}

function GroupedLiquidGlassSurface({ surface }: { surface: GroupSurface }) {
  const config = toneConfig[surface.tone];

  return (
    <div
      aria-hidden="true"
      className={[
        "site-liquid-group__surface",
        `site-liquid-group__surface--${surface.tone}`,
        surface.isActive ? "site-liquid-group__surface--active" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        ...getPointerStyle(surface),
        width: `${surface.frameWidth}px`,
        height: `${surface.frameHeight}px`,
        transform: `translate3d(${surface.left}px, ${surface.top}px, 0)`,
      }}
    >
      <div
        className="site-liquid-group__viewport"
        style={{ width: `${surface.width}px`, height: `${surface.height}px` }}
      >
        <LiquidGlassSurface
          // 包仅在挂载或 resize 时测量自身尺寸；只有组布局变更才重建测量。
          key={`${surface.frameWidth}:${surface.frameHeight}`}
          mode="standard"
          displacementScale={config.displacementScale}
          blurAmount={config.blurAmount}
          saturation={config.saturation}
          aberrationIntensity={config.aberrationIntensity}
          elasticity={config.elasticity}
          cornerRadius={config.cornerRadius}
          padding="0"
          overLight={config.overLight}
          globalMousePos={{ x: surface.globalX, y: surface.globalY }}
          mouseOffset={{ x: surface.offsetX, y: surface.offsetY }}
          // 与库内部 translate(-50%, -50%) 配对；共享层自身再负责成员间位移。
          style={{
            position: "absolute",
            top: `${surface.frameHeight / 2}px`,
            left: `${surface.frameWidth / 2}px`,
          }}
        >
          <span
            className="site-liquid-group__sizer"
            style={{ width: `${surface.frameWidth}px`, height: `${surface.frameHeight}px` }}
          />
        </LiquidGlassSurface>
      </div>
    </div>
  );
}

/** 官网可点击液态玻璃控件；未置于 Group 中时保持独立的 pointer-follow 效果。 */
export function LiquidGlass(props: LiquidGlassProps) {
  const group = useContext(LiquidGlassGroupContext);

  return group ? <GroupedLiquidGlass {...props} group={group} /> : <StandaloneLiquidGlass {...props} />;
}

function GroupedLiquidGlass({
  href,
  children,
  tone = "secondary",
  className = "",
  external = false,
  download,
  group,
}: LiquidGlassProps & { group: LiquidGlassGroupContextValue }) {
  const memberId = useId();
  const memberRef = useCallback(
    (element: HTMLAnchorElement | null) => group.registerMember(memberId, element),
    [group, memberId],
  );

  const activate = (event: PointerEvent<HTMLAnchorElement>) => {
    group.activateMember(memberId, tone, event);
  };

  return (
    <a
      ref={memberRef}
      href={href}
      className={["site-liquid-link", "site-liquid-link--grouped", `site-liquid-link--${tone}`, className]
        .filter(Boolean)
        .join(" ")}
      download={download}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      onPointerEnter={activate}
      onPointerMove={activate}
      onPointerCancel={group.resetSurface}
      onBlur={group.resetSurface}
    >
      <span className="site-liquid-link__label site-liquid-link__label--overlay">{children}</span>
    </a>
  );
}

function StandaloneLiquidGlass({
  href,
  children,
  tone = "secondary",
  className = "",
  external = false,
  download,
}: LiquidGlassProps) {
  const animationFrameRef = useRef<number | null>(null);
  const nextPointerPositionRef = useRef(restingPointerPosition);
  const [pointerPosition, setPointerPosition] = useState(restingPointerPosition);
  const config = toneConfig[tone];

  const schedulePointerPosition = useCallback((nextPosition: PointerPosition) => {
    nextPointerPositionRef.current = nextPosition;

    if (animationFrameRef.current !== null) {
      return;
    }

    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null;
      setPointerPosition(nextPointerPositionRef.current);
    });
  }, []);

  const resetPointerPosition = useCallback(() => {
    schedulePointerPosition(restingPointerPosition);
  }, [schedulePointerPosition]);

  const canTrackPointer = useFinePointerCapability(resetPointerPosition);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  const handlePointerMove = (event: PointerEvent<HTMLAnchorElement>) => {
    if (!canTrackPointer || event.pointerType !== "mouse") {
      return;
    }

    schedulePointerPosition(getPointerPosition(event, event.currentTarget.getBoundingClientRect()));
  };

  return (
    <a
      href={href}
      className={["site-liquid-link", `site-liquid-link--${tone}`, className]
        .filter(Boolean)
        .join(" ")}
      style={getPointerStyle(pointerPosition)}
      download={download}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      onPointerMove={handlePointerMove}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") {
          resetPointerPosition();
        }
      }}
      onPointerCancel={resetPointerPosition}
      onBlur={resetPointerPosition}
    >
      <LiquidGlassSurface
        mode="standard"
        displacementScale={config.displacementScale}
        blurAmount={config.blurAmount}
        saturation={config.saturation}
        aberrationIntensity={config.aberrationIntensity}
        elasticity={config.elasticity}
        cornerRadius={config.cornerRadius}
        padding={config.padding}
        overLight={config.overLight}
        globalMousePos={{ x: pointerPosition.globalX, y: pointerPosition.globalY }}
        mouseOffset={{ x: pointerPosition.offsetX, y: pointerPosition.offsetY }}
        // 与库内部 translate(-50%, -50%) 配对；必须 absolute，否则会按文档流再偏移半个自身。
        style={{ position: "absolute", top: "50%", left: "50%" }}
      >
        <span className="site-liquid-link__label site-liquid-link__label--visual" aria-hidden="true">
          {children}
        </span>
      </LiquidGlassSurface>
      <span className="site-liquid-link__label site-liquid-link__label--overlay">{children}</span>
    </a>
  );
}

// 兼容已存在的调用方；新代码优先使用 LiquidGlass 作为组内成员。
export const LiquidGlassLink = LiquidGlass;
