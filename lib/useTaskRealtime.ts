"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

// Keeps the admin Kanban and the client Feedbacks page in sync live: any
// `tasks` row change this session is allowed to see (per RLS — admin sees
// every client, a client session only its own client_visible rows) triggers
// `onChange`, which callers use to refetch. Debounced so a batch of PATCHes
// (e.g. drag-and-drop reordering several cards) only refetches once.
export function useTaskRealtime(onChange: () => void) {
  const cbRef = useRef(onChange);
  cbRef.current = onChange;

  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const channel = supabase
      .channel("tasks-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => {
        window.clearTimeout(timer);
        timer = setTimeout(() => cbRef.current(), 300);
      })
      .subscribe();
    return () => {
      window.clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, []);
}
