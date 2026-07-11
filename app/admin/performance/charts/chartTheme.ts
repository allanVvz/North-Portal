"use client";

import { useEffect, useState } from "react";

// Resolved chart colors read live from the .admin-shell CSS tokens, so
// Recharts (which needs literal color values, not var() strings in every
// prop) matches the design system in BOTH themes. Re-reads on the existing
// `admin-theme-change` event (AdminShell dispatch/listen pair) so charts
// restyle instantly when the user toggles claro/escuro — no reload.

export type ChartTheme = {
  ink: string;
  sec: string;
  muted: string;
  grid: string;
  surface: string;
  border: string;
  // Fixed slot order — assigned by entity, never cycled: teal, blue, gold, purple.
  series: [string, string, string, string];
};

const FALLBACK: ChartTheme = {
  ink: "#0c2c2c",
  sec: "#46584f",
  muted: "#7c8a82",
  grid: "#dee3dd",
  surface: "#fbfcfa",
  border: "#dee3dd",
  series: ["#4a857c", "#3c6285", "#8a6d2f", "#6a5a82"],
};

// Dark-theme series get lighter tints — the *-text tokens are tuned for text
// on soft chips, too dim as chart strokes on the dark surface.
const DARK_SERIES: ChartTheme["series"] = ["#78aca8", "#a6c6e0", "#e6c07f", "#c3b4d6"];

function readTheme(): ChartTheme {
  if (typeof document === "undefined") return FALLBACK;
  const shell = document.querySelector(".admin-shell");
  if (!shell) return FALLBACK;
  const cs = getComputedStyle(shell);
  const get = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  const isDark = shell.getAttribute("data-theme") === "dark";
  return {
    ink: get("--a-ink", FALLBACK.ink),
    sec: get("--a-sec", FALLBACK.sec),
    muted: get("--a-muted", FALLBACK.muted),
    grid: get("--a-border", FALLBACK.grid),
    surface: get("--a-surface", FALLBACK.surface),
    border: get("--a-border", FALLBACK.border),
    series: isDark
      ? DARK_SERIES
      : [
          get("--a-teal-strong", FALLBACK.series[0]),
          get("--a-blue-text", FALLBACK.series[1]),
          get("--a-gold-text", FALLBACK.series[2]),
          get("--a-purple-text", FALLBACK.series[3]),
        ],
  };
}

export function useChartTheme(): ChartTheme {
  const [theme, setTheme] = useState<ChartTheme>(FALLBACK);
  useEffect(() => {
    setTheme(readTheme());
    const update = () => setTheme(readTheme());
    // Two change paths exist: SettingsPanel dispatches admin-theme-change,
    // but AdminShell's own sidebar toggle only flips the data-theme
    // attribute — the MutationObserver catches that one (and any future
    // path) without needing every toggler to remember to dispatch.
    window.addEventListener("admin-theme-change", update);
    const shell = document.querySelector(".admin-shell");
    const observer = shell ? new MutationObserver(update) : null;
    if (shell && observer) observer.observe(shell, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      window.removeEventListener("admin-theme-change", update);
      observer?.disconnect();
    };
  }, []);
  return theme;
}

// Shared tooltip contentStyle so all three charts read identically.
export function tooltipStyle(t: ChartTheme): React.CSSProperties {
  return {
    background: t.surface,
    border: `1px solid ${t.border}`,
    borderRadius: 10,
    fontSize: 12.5,
    color: t.ink,
    boxShadow: "0 8px 24px rgba(0,0,0,.12)",
  };
}
