"use client";

import { useState } from "react";
import AcquisitionDashboard from "./AcquisitionDashboard";
import PerformanceBoard from "./PerformanceBoard";
import PerformanceCampaignTable from "./PerformanceCampaignTable";
import PerformanceDashboard from "./PerformanceDashboard";
import PerformanceToolbar from "./PerformanceToolbar";
import { COLUMN_KIND } from "./performanceLabels";
import { usePerformanceWorkspace } from "./usePerformanceWorkspace";
import { CAMPAIGN_METRIC_COLUMNS } from "@/lib/performancePrefs";
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
  // Aquisição é a primeira tela de Performance (pedido do usuário).
  const [view, setView] = useState<View>("acquisition");
  // Analytics e Aquisição compartilham uma única instância de estado — o
  // hook é chamado uma vez aqui. O topo (filtro) e a tabela inferior
  // (Campanhas/Conjuntos/Criativos) renderizam uma ÚNICA vez, fora de
  // qualquer uma das duas telas, para que "fixos entre as duas abas" seja
  // literal (mesma instância no DOM, não uma cópia por aba) — só o
  // "canvas" do meio (KPIs/funil/gráficos) troca ao trocar de aba.
  const workspace = usePerformanceWorkspace({ clients, canEdit });
  const showPerformanceSurface = view === "dashboard" || view === "acquisition";

  return (
    <div className="perf-screen">
      <div className="kb-viewtabs perf-viewtabs">
        <button className={view === "acquisition" ? "on" : ""} onClick={() => setView("acquisition")}>Aquisição</button>
        <button className={view === "dashboard" ? "on" : ""} onClick={() => setView("dashboard")}>Analytics</button>
        <button className={view === "cards" ? "on" : ""} onClick={() => setView("cards")}>Cards publicados</button>
      </div>
      {showPerformanceSurface ? (
        <div className="perf-dash">
          <PerformanceToolbar workspace={workspace} view={view === "acquisition" ? "acquisition" : "dashboard"} />
          {view === "dashboard" ? <PerformanceDashboard workspace={workspace} /> : <AcquisitionDashboard workspace={workspace} />}
          <PerformanceCampaignTable
            level={workspace.entityLevel}
            onChangeLevel={workspace.changeEntityLevel}
            campaigns={workspace.campaigns}
            campaignTotal={workspace.campaignsAll.length}
            entityRows={workspace.entitySummaries}
            columns={workspace.columns}
            allColumns={CAMPAIGN_METRIC_COLUMNS}
            columnKind={COLUMN_KIND}
            visibleColumns={workspace.visibleColumns}
            onToggleColumn={workspace.toggleColumn}
            columnsMenuOpen={workspace.columnsMenuOpen}
            onToggleColumnsMenu={() => workspace.setColumnsMenuOpen((v) => !v)}
            sortKey={workspace.sortKey}
            sortDir={workspace.sortDir}
            onToggleSort={workspace.toggleSort}
            selectedCampaignIds={workspace.selectedCampaignIds}
            selectedAdsetIds={workspace.selectedAdsetIds}
            selectedAdIds={workspace.selectedAdIds}
            onToggleCampaign={workspace.toggleCampaignSelection}
            onToggleAllCampaigns={workspace.toggleAllCampaigns}
            onToggleEntity={workspace.toggleEntitySelection}
            onToggleAllEntities={workspace.toggleAllEntities}
            entityLoading={workspace.entityLevel !== "campaign" && workspace.drillLoading}
            entityError={workspace.entityLevel !== "campaign" ? workspace.drillError : ""}
            expanded={workspace.expanded}
            adRowsFor={workspace.adRowsFor}
            onToggleExpand={workspace.toggleExpand}
            onExportCsv={workspace.exportCsv}
            onLoadMore={() => workspace.setVisibleCount((n) => n + 25)}
            categoryNote={workspace.category !== "ads"}
            canEditTemplate={workspace.canEdit}
            campaignBlocks={workspace.campaignBlocks}
            adSourceTags={workspace.adSourceTags}
            onSetCampaignBlock={workspace.setCampaignBlock}
            onSetAdSourceTag={workspace.setAdSourceTag}
            suggestBlock={workspace.suggestCampaignBlock}
          />
        </div>
      ) : (
        <PerformanceBoard initial={initialTasks} clients={clients} canEdit={canEdit} />
      )}
    </div>
  );
}
