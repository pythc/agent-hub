import React from "react";
import { Easing, interpolate } from "remotion";
export const clamp = (v: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, v));
export const ease = (v: number) => Easing.bezier(0.16, 1, 0.3, 1)(clamp(v));
export const reveal = (
  t: number,
  from: number,
  duration = 0.45,
): React.CSSProperties => ({
  opacity: clamp((t - from) / duration),
  translate: `0 ${(1 - ease((t - from) / duration)) * 9}px`,
});
export const typeText = (
  text: string,
  t: number,
  start: number,
  duration: number,
) => text.slice(0, Math.floor(clamp((t - start) / duration) * text.length));
export type Point = { t: number; x: number; y: number };
export type Focus = { t: number; x: number; y: number; z: number };
export function interpolatePath(t: number, path: Point[]) {
  return {
    x: interpolate(
      t,
      path.map((p) => p.t),
      path.map((p) => p.x),
      {
        easing: Easing.bezier(0.45, 0, 0.2, 1),
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      },
    ),
    y: interpolate(
      t,
      path.map((p) => p.t),
      path.map((p) => p.y),
      {
        easing: Easing.bezier(0.45, 0, 0.2, 1),
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      },
    ),
  };
}
export function Camera({
  t,
  focus,
  children,
}: {
  t: number;
  focus: Focus[];
  children: React.ReactNode;
}) {
  const settings = {
    easing: Easing.bezier(0.4, 0, 0.15, 1),
    extrapolateLeft: "clamp" as const,
    extrapolateRight: "clamp" as const,
  };
  const z = interpolate(
      t,
      focus.map((p) => p.t),
      focus.map((p) => p.z),
      settings,
    ),
    x = interpolate(
      t,
      focus.map((p) => p.t),
      focus.map((p) => p.x),
      settings,
    ),
    y = interpolate(
      t,
      focus.map((p) => p.t),
      focus.map((p) => p.y),
      settings,
    );
  return (
    <div
      className="camera"
      style={{
        translate: `${clamp(720 - x * z, 1440 * (1 - z), 0)}px ${clamp(405 - y * z, 810 * (1 - z), 0)}px`,
        scale: z,
      }}
    >
      {children}
    </div>
  );
}
export function Cursor({
  t,
  path,
  clicks = [],
  label,
}: {
  t: number;
  path: Point[];
  clicks?: number[];
  label?: string;
}) {
  if (!path.length) return null;
  const p = interpolatePath(t, path),
    last = path[path.length - 1].t;
  const clicked = clicks.some((c) => t >= c && t < c + 0.13);
  return (
    <>
      <div
        data-demo-cursor
        style={{
          position: "absolute",
          left: p.x,
          top: p.y,
          zIndex: 30,
          opacity: clamp(t * 3) * clamp((last + 2 - t) / 0.4),
          scale: clicked ? 0.88 : 1,
          transformOrigin: "0 0",
          pointerEvents: "none",
        }}
      >
        <svg
          width="29"
          height="38"
          viewBox="0 0 29 38"
          style={{ filter: "drop-shadow(0 2px 3px #0005)" }}
        >
          <path
            d="M2 2v29l7-7 6 12 5-3-6-11 11-1L2 2z"
            fill="#151515"
            stroke="#fff"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
        {label && <span className="cursor-label">{label}</span>}
      </div>
      {clicks.map((c) => {
        const q = interpolatePath(c, path),
          d = (t - c) / 0.55;
        return d >= 0 && d <= 1 ? (
          <div
            key={c}
            style={{
              position: "absolute",
              zIndex: 29,
              left: q.x - 18,
              top: q.y - 18,
              width: 36,
              height: 36,
              border: "2px solid #737373",
              background: "#88888812",
              borderRadius: "50%",
              scale: 0.25 + d * 1.65,
              opacity: 1 - d,
              pointerEvents: "none",
            }}
          />
        ) : null;
      })}
    </>
  );
}
export const wide: Focus[] = [{ t: 0, x: 720, y: 405, z: 1 }];
