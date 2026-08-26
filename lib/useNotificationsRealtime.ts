"use client";

import { useEffect, useId, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

// Same idiom as lib/useTaskRealtime.ts, scoped to one account's own
// notifications via a postgres_changes filter (RLS still governs what a
// session may actually receive either way — see "notifications read own or
// admin" in supabase/migrations/20260819000001_notifications.sql). Debounced
// for the same reason: a batch of writes (e.g. "mark all read") should only
// trigger one refetch.
//
// Wired to the admin bell/dropdown in app/admin/AdminShell.tsx, which reads
// from GET /api/admin/notifications and points its refetch at this hook the
// same way the Kanban/Feedbacks screens use useTaskRealtime.
export function useNotificationsRealtime(profileId: string, onChange: () => void) {
  const cbRef = useRef(onChange);
  cbRef.current = onChange;
  // The topic has to be unique per hook instance, not per account: supabase-js
  // hands back the existing channel when a topic repeats, and adding a second
  // postgres_changes listener to an already-subscribed channel throws. Two
  // components observe this now (the shell's bell and the Home panel).
  const instanceId = useId();

  useEffect(() => {
    if (!profileId) return;
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const channel = supabase
      .channel(`notifications-changes-${profileId}-${instanceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `profile_id=eq.${profileId}` },
        () => {
          window.clearTimeout(timer);
          timer = setTimeout(() => cbRef.current(), 300);
        },
      )
      .subscribe();
    return () => {
      window.clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [profileId, instanceId]);
}
