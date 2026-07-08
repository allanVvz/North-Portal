"use client";

import { useEffect, useState } from "react";

export type SiteTheme = "light" | "dark";

/** Shared claro/escuro toggle for the public site + auth screens (same
 *  localStorage key as SiteFrame, so a choice made on one carries to the other).
 *
 *  Deliberately starts at "light" (matching the server render) and corrects via
 *  effect after mount: a lazy localStorage-read initializer was tried here and
 *  reverted — it reads a different value client-side than the server rendered,
 *  which Next.js flags as a hydration mismatch ("Recoverable Error", tree is
 *  discarded and regenerated client-side) — worse than the brief flash it aimed
 *  to avoid. A real fix needs the theme resolved server-side (cookie), not just
 *  read earlier client-side; tracked as backlog in docs/DIVERGENCIAS-FIGMA.md. */
export function useSiteTheme(): [SiteTheme, () => void] {
  const [theme, setTheme] = useState<SiteTheme>("light");

  useEffect(() => {
    const saved = window.localStorage.getItem("site-theme");
    if (saved === "dark" || saved === "light") setTheme(saved);
  }, []);
  useEffect(() => {
    window.localStorage.setItem("site-theme", theme);
  }, [theme]);

  return [theme, () => setTheme((t) => (t === "light" ? "dark" : "light"))];
}
