"use client";

import { useEffect, useState } from "react";

// Local device preference — separate from kanbanAttrs.ts (which owns the
// per-attribute visibility map) since this is a single on/off board behavior:
// whether clicking a kanban card shows the sidebar (TaskDetailPanel) as an
// intermediate step, or jumps straight into the centered TaskModal. Defaults
// to OFF — the modal opens directly by default; turning this on makes the
// sidebar the intermediate step before the full modal.
const STORAGE_KEY = "kb-sidebar-enabled";
const EVENT = "kb-sidebar-enabled-change";

function readPref(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function useSidebarEnabledPref() {
  const [sidebarEnabled, setSidebarEnabledState] = useState(false);

  useEffect(() => {
    setSidebarEnabledState(readPref());
    function onChange() { setSidebarEnabledState(readPref()); }
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  function setSidebarEnabled(value: boolean) {
    window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
    setSidebarEnabledState(value);
    window.dispatchEvent(new Event(EVENT));
  }

  return { sidebarEnabled, setSidebarEnabled };
}
