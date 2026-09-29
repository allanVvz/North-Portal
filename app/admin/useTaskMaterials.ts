"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CreativeMaterialWorkspace } from "@/lib/cardMaterials";

export function useTaskMaterials(taskId: string | null, enabled: boolean) {
  const [workspaces, setWorkspaces] = useState<CreativeMaterialWorkspace[]>([]);
  const [warning, setWarning] = useState("");
  const request = useRef(0);
  const reload = useCallback(() => {
    if (!taskId) return;
    const requestId = ++request.current;
    fetch("/api/admin/drive/baita/materials", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId }), cache: "no-store",
    })
      .then((response) => response.ok ? response.json() : null)
      .then((data: { workspaces?: CreativeMaterialWorkspace[]; syncWarnings?: string[] } | null) => {
        if (requestId !== request.current || !data?.workspaces) return;
        setWorkspaces(data.workspaces);
        setWarning(data.syncWarnings?.length ? "O Drive não concluiu a sincronização dos materiais. Abra a pasta para tentar novamente." : "");
      })
      .catch(() => {});
  }, [taskId]);
  useEffect(() => {
    if (!enabled || !taskId) return () => { request.current += 1; };
    reload();
    const onFocus = () => reload();
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") reload(); }, 60_000);
    return () => { window.removeEventListener("focus", onFocus); window.clearInterval(timer); request.current += 1; };
  }, [enabled, taskId, reload]);
  return { workspaces, warning, reload };
}
