"use client";

import { useState } from "react";
import PerformanceBoard from "./PerformanceBoard";
import PerformanceDashboard from "./PerformanceDashboard";
import type { PublishedTask } from "@/lib/supabase";

type ClientLite = { slug: string; name: string };
type View = "dashboard" | "cards";

// Performance now has two views: the analytics Dashboard (Meta data via
// Windsor, or demo data when not connected) and the original Cards list
// (published tasks with manually-editable metrics), untouched.
export default function PerformanceScreen({
  initialTasks,
  clients,
  canEdit,
}: {
  initialTasks: PublishedTask[];
  clients: ClientLite[];
  canEdit: boolean;
}) {
  const [view, setView] = useState<View>("dashboard");

  return (
    <div className="perf-screen">
      <div className="kb-viewtabs perf-viewtabs">
        <button className={view === "dashboard" ? "on" : ""} onClick={() => setView("dashboard")}>Dashboard</button>
        <button className={view === "cards" ? "on" : ""} onClick={() => setView("cards")}>Cards</button>
      </div>
      {view === "dashboard" ? (
        <PerformanceDashboard clients={clients} />
      ) : (
        <PerformanceBoard initial={initialTasks} clients={clients} canEdit={canEdit} />
      )}
    </div>
  );
}
