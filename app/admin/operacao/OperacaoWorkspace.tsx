"use client";

import { useEffect, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ActionPlan, FlowDelivery, RecurringTask } from "@/lib/supabase";
import ParentCardsBoard from "./ParentCardsBoard";
import TarefasRotinasBoard from "./TarefasRotinasBoard";

type Area = "tarefas-rotinas" | "planos-entregas";

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

  function setArea(next: Area) {
    if (next === area) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("area", next);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return <section className="admin-page kb-wide clients-workspace op-page">
    <header className="admin-head"><div><h1 className="admin-title">Operação</h1><p className="admin-sub">Tarefas do dia a dia, rotinas, planos e entregas.</p></div></header>
    <nav className="clients-section-tabs" aria-label="Áreas da operação">
      <button type="button" className={area === "tarefas-rotinas" ? "on" : ""} onClick={() => setArea("tarefas-rotinas")}>Tarefas e Rotinas</button>
      <button type="button" className={area === "planos-entregas" ? "on" : ""} onClick={() => setArea("planos-entregas")}>Planos e Entregas <span>{plans.length + deliveries.length}</span></button>
    </nav>
    {area === "tarefas-rotinas" ? <TarefasRotinasBoard clients={activeClients} assignees={assignees} initialRoutines={recurringTasks} /> : <ParentCardsBoard variant="combined" plans={plans} deliveries={deliveries} />}
  </section>;
}
