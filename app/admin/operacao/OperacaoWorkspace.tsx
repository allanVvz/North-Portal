"use client";

import { useEffect, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ActionPlan, FlowDelivery, RecurringTask } from "@/lib/supabase";
import ParentCardsBoard from "./ParentCardsBoard";
import TarefasRotinasBoard from "./TarefasRotinasBoard";
import ScreenHeader from "../ScreenHeader";
import InsightsRail from "../insights/InsightsRail";
import { buildInsightCandidates, countFor, dueOf } from "../insights/insightCandidates";
import { useOperationData } from "./useOperationItems";
import { operacaoHref } from "./operacaoLinks";
import { operationStatusOf } from "./operationItems";
import { agencyToday } from "../recurringState";

type Area = "tarefas-rotinas" | "planos-entregas";

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function areaOf(value: string | null): Area { return value === "planos-entregas" ? "planos-entregas" : "tarefas-rotinas"; }

/** The operation URL is the source of truth. This makes Back/Forward useful and
 * preserves a task or situation deep-link while the person changes surface. */
export default function OperacaoWorkspace({
  clients, plans, deliveries, recurringTasks, assignees,
}: {
  clients: { slug: string; name: string; disabled?: boolean }[];
  plans: ActionPlan[];
  deliveries: FlowDelivery[];
  recurringTasks: RecurringTask[];
  assignees: string[];
  recurringStorageAvailable: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const area = areaOf(searchParams.get("area"));
  const activeClients = useMemo(() => clients.filter((client) => !client.disabled), [clients]);

  useEffect(() => {
    if (searchParams.get("area") === area) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("area", area);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [area, pathname, router, searchParams]);

  // Cabeçalho e insights leem a mesma Operação (useOperationData). Os números
  // saem do mesmo filtro que o link aplica: quem clica vê a mesma contagem.
  const today = useMemo(() => agencyToday(), []);
  const ops = useOperationData();
  const lateCount = ops ? countFor(ops.items, { situacao: "atrasada" }, today) : null;
  const stalledCount = ops ? countFor(ops.items, { situacao: "parada" }, today) : null;
  const weekCount = ops ? ops.items.filter((item) => {
    if (operationStatusOf(item) === "aprovado" || item.task.completed_at) return false;
    const due = dueOf(item)?.slice(0, 10);
    return Boolean(due && due >= today && due <= addDays(today, 7));
  }).length : null;
  const candidates = useMemo(() => (ops ? buildInsightCandidates("operacao", { items: ops.items, tasks: ops.tasks, today }) : null), [ops, today]);

  function setArea(next: Area) {
    if (next === area) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("area", next);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return <section className="admin-page kb-wide clients-workspace op-page">
    <ScreenHeader
      title="Operação"
      lede="Tarefas, rotinas, planos e entregas: cada trabalho aparece uma vez, no nível mais importante."
      period="agora"
      kpis={[
        { label: "atrasados", value: lateCount ?? "…", href: operacaoHref({ situacao: "atrasada", agrupar: "responsavel" }), tone: lateCount ? "late" : undefined },
        { label: "parados", value: stalledCount ?? "…", href: operacaoHref({ situacao: "parada" }), tone: stalledCount ? "warn" : undefined },
        { label: "vencem em 7 dias", value: weekCount ?? "…", href: operacaoHref({ agrupar: "prazo" }) },
      ]}
    />
    <InsightsRail screen="operacao" candidates={candidates} />
    <nav className="clients-section-tabs" aria-label="Áreas da operação">
      <button type="button" className={area === "tarefas-rotinas" ? "on" : ""} onClick={() => setArea("tarefas-rotinas")}>Tarefas e Rotinas</button>
      <button type="button" className={area === "planos-entregas" ? "on" : ""} onClick={() => setArea("planos-entregas")}>Planos e Entregas <span>{plans.length + deliveries.length}</span></button>
    </nav>
    {area === "tarefas-rotinas" ? <TarefasRotinasBoard clients={activeClients} assignees={assignees} initialRoutines={recurringTasks} /> : <ParentCardsBoard variant="combined" plans={plans} deliveries={deliveries} />}
  </section>;
}
