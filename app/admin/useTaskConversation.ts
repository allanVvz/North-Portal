"use client";

import { useCallback, useEffect, useState } from "react";
import type { ConversationItem } from "@/lib/cardConversation";

/** Read the canonical conversation projection for the currently opened card. */
export function useTaskConversation(taskId: string | null) {
  const [items, setItems] = useState<ConversationItem[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    let cancelled = false;
    if (!taskId) { setItems([]); setLoadedFor(null); return; }
    setLoadedFor(null);
    fetch(`/api/admin/tasks/${taskId}/conversation`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<{ items?: ConversationItem[] }> : null)
      .then((body) => { if (!cancelled && body && Array.isArray(body.items)) { setItems(body.items); setLoadedFor(taskId); } })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [taskId, revision]);
  return { items: loadedFor === taskId ? items : [], ready: loadedFor === taskId, reload };
}
