"use client";

import { useState } from "react";
import AcquisitionDashboard from "./AcquisitionDashboard";
import PerformanceBoard from "./PerformanceBoard";
import PerformanceDashboard from "./PerformanceDashboard";
import type { PublishedTask } from "@/lib/supabase";

type ClientLite = { slug: string; name: string };
type View = "dashboard" | "acquisition" | "cards";

// Paid ads are the current analytics surface. Organic will become a separate
// top-level view later; it is intentionally not mixed into this dashboard.
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
        <button className={view === "dashboard" ? "on" : ""} onClick={() => setView("dashboard")}>Analytics</button>
        <button className={view === "acquisition" ? "on" : ""} onClick={() => setView("acquisition")}>Aquisição</button>
        <button className={view === "cards" ? "on" : ""} onClick={() => setView("cards")}>Cards publicados</button>
      </div>
      {view === "dashboard" ? (
        <PerformanceDashboard clients={clients} canEdit={canEdit} />
      ) : view === "acquisition" ? (
        <AcquisitionDashboard />
      ) : (
        <PerformanceBoard initial={initialTasks} clients={clients} canEdit={canEdit} />
      )}
    </div>
  );
}
