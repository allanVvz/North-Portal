"use client";

import { useEffect, useMemo, useState } from "react";
import ClientsTable, { type ClientRow } from "../ClientsTable";
import ScreenHeader from "../ScreenHeader";
import InsightsRail from "../insights/InsightsRail";
import { buildInsightCandidates, countFor } from "../insights/insightCandidates";
import { useOperationData } from "../operacao/useOperationItems";
import { operacaoHref } from "../operacao/operacaoLinks";
import { useClientInsights, compact } from "../home/useInsights";
import { agencyToday } from "../recurringState";
import type { Piece } from "@/lib/pieces";
import ClientCards from "./ClientCards";
import LeadsScreen from "./LeadsScreen";
import { useClientesPrefs } from "./leadsPrefs";
import type { LeadRecord } from "@/lib/supabase";

// Duas telas na mesma rota, com a seleção na linha superior — mesmo formato de
// /admin/operacao (Tarefas/Rotinas/Plano) e de /admin/documentos. O projeto
// nunca transformou "ângulos da mesma seção" em rota nova, então nada muda em
// NAV_ITEMS e o menu lateral segue destacando Clientes.
//
// Sem estado compartilhado entre as duas: elas não dividem filtro nem dados, e
// os dois conjuntos já vêm prontos do server component. O padrão pesado de
// usePerformanceWorkspace só se paga quando as telas precisam do mesmo fetch.
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export default function ClientesWorkspace({
  clients,
  leads,
  needingAttention,
}: {
  clients: ClientRow[];
  leads: LeadRecord[];
  /** Clientes com pendência de cadastro (briefing, métricas, relatório, plano). */
  needingAttention: number;
}) {
  const { section, view, setSection, setView } = useClientesPrefs();
  const novos = leads.filter((lead) => lead.status === "novo").length;
  // Painel (dados de operação e relatórios) ou Cadastro (a grade de sempre).
  const [clientView, setClientView] = useState<"painel" | "cadastro">("painel");

  // Uma leitura por visita, compartilhada pelo cabeçalho, pelos insights e
  // pelos cards. Os números de Clientes cobrem o MÊS (30/09): quem está com
  // atraso, o que foi entregue e quanto a carteira cresceu. Investimento fica
  // na Performance.
  const today = useMemo(() => agencyToday(), []);
  const ops = useOperationData();
  const insights = useClientInsights();
  const [pieces, setPieces] = useState<Piece[] | null>(null);
  useEffect(() => {
    let active = true;
    fetch("/api/admin/pieces?limit=500", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { pieces?: Piece[] } | null) => { if (active) setPieces(data?.pieces ?? []); })
      .catch(() => { if (active) setPieces([]); });
    return () => { active = false; };
  }, []);

  const activeClients = clients.filter((client) => !client.disabled);
  const month = today.slice(0, 7);
  const monthName = MONTHS[Number(today.slice(5, 7)) - 1];
  const lateClients = ops ? new Set(activeClients.filter((client) => countFor(ops.items, { cliente: client.name, situacao: "atrasada" }, today) > 0).map((client) => client.slug)).size : null;
  const doneMonth = pieces ? pieces.filter((piece) => piece.state === "concluida" && piece.date?.slice(0, 7) === month).length : null;
  const gainsMonth = insights ? insights.reduce((sum, row) => sum + row.followers.filter((week) => week.periodTo.slice(0, 7) === month).reduce((acc, week) => acc + (week.gain ?? 0), 0), 0) : null;
  const candidates = useMemo(
    () => (ops && insights && pieces ? buildInsightCandidates("clientes", { items: ops.items, tasks: ops.tasks, today, insights, pieces }) : null),
    [ops, insights, pieces, today],
  );
  const lede = [
    `${activeClients.length} clientes ativos`,
    needingAttention ? `${needingAttention} com cadastro pendente` : "",
    novos ? `${novos} lead${novos === 1 ? "" : "s"} sem triagem` : "",
  ].filter(Boolean).join(" · ");

  return (
    <>
      <ScreenHeader
        title="Clientes"
        lede={`${lede}.`}
        period={monthName}
        kpis={section === "clientes" ? [
          { label: "com atraso", value: lateClients ?? "…", hint: `de ${activeClients.length}`, href: operacaoHref({ situacao: "atrasada", agrupar: "cliente" }), tone: lateClients ? "late" : undefined },
          { label: "peças concluídas", value: doneMonth ?? "…", href: "/admin/operacao?area=planos-entregas&visao=feed&estado=concluida", tone: "ok" },
          { label: "seguidores ganhos", value: gainsMonth === null ? "…" : gainsMonth ? `+${compact(gainsMonth)}` : "—" },
        ] : undefined}
      />
      <nav className="clients-section-tabs" aria-label="Seções de clientes">
        <button type="button" className={section === "clientes" ? "on" : ""} onClick={() => setSection("clientes")}>
          Clientes <span>{clients.filter((c) => !c.disabled).length}</span>
        </button>
        <button type="button" className={section === "leads" ? "on" : ""} onClick={() => setSection("leads")}>
          Leads {novos > 0 ? <span>{novos}</span> : null}
        </button>
      </nav>

      {section === "clientes" ? (
        clients.length ? (
          <>
            <div className="kb-viewtabs leads-viewtabs" role="group" aria-label="Visualização dos clientes">
              <button type="button" className={clientView === "painel" ? "on" : ""} onClick={() => setClientView("painel")}>Painel</button>
              <button type="button" className={clientView === "cadastro" ? "on" : ""} onClick={() => setClientView("cadastro")}>Cadastro</button>
            </div>
            {clientView === "painel" ? (
              <>
                <InsightsRail screen="clientes" candidates={candidates} />
                <ClientCards clients={clients} items={ops?.items ?? null} pieces={pieces ?? []} insights={insights} today={today} />
              </>
            ) : <ClientsTable clients={clients} />}
          </>
        ) : <p className="admin-empty">Nenhum cliente ainda. Crie o primeiro.</p>
      ) : (
        <>
          <div className="kb-viewtabs leads-viewtabs" role="group" aria-label="Visualização dos leads">
            <button type="button" className={view === "kanban" ? "on" : ""} onClick={() => setView("kanban")}>Kanban</button>
            <button type="button" className={view === "tabela" ? "on" : ""} onClick={() => setView("tabela")}>Tabela</button>
          </div>
          <LeadsScreen leads={leads} view={view} />
        </>
      )}
    </>
  );
}
