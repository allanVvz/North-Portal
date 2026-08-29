import type { TaskStatus } from "./validation";

// Pure derivations behind the admin Home KPIs. No Supabase import on purpose —
// same split as lib/notifications.ts, so the interesting logic is unit-testable
// without a database.

export type AttentionReason = "briefing_pendente" | "sem_metricas" | "sem_relatorio" | "sem_plano";

export const ATTENTION_LABEL: Record<AttentionReason, string> = {
  briefing_pendente: "Briefing pendente",
  sem_metricas: "Sem métricas",
  sem_relatorio: "Sem relatório",
  sem_plano: "Sem plano de ação",
};

export type OverviewLike = {
  slug: string;
  name: string;
  is_active: boolean;
  briefing_submitted: boolean;
  metricsCount: number;
  hasReport: boolean;
  planCount: number;
};

export type ClientAttention = { slug: string; name: string; reasons: AttentionReason[] };

/**
 * Clients with something missing that the North team is supposed to fix.
 * Inactive clients are skipped: an inactive client is missing everything by
 * definition, which would bury the ones that actually need work.
 */
export function deriveClientsNeedingAttention(rows: OverviewLike[]): ClientAttention[] {
  return rows
    .filter((r) => r.is_active)
    .map((r) => {
      const reasons: AttentionReason[] = [];
      if (!r.briefing_submitted) reasons.push("briefing_pendente");
      if (r.metricsCount === 0) reasons.push("sem_metricas");
      if (!r.hasReport) reasons.push("sem_relatorio");
      if (r.planCount === 0) reasons.push("sem_plano");
      return { slug: r.slug, name: r.name, reasons };
    })
    .filter((r) => r.reasons.length > 0)
    // Most-broken first: that's the order someone triaging would want.
    .sort((a, b) => b.reasons.length - a.reasons.length || a.name.localeCompare(b.name, "pt-BR"));
}

export type PlanLike = { status: TaskStatus; progress: number };

const TERMINAL: TaskStatus[] = ["aprovado"];

export function plansInProgress<T extends PlanLike>(plans: T[]): T[] {
  return plans.filter((p) => !TERMINAL.includes(p.status) && p.status !== "parada");
}

/** Mean progress of the plans still running, rounded. 0 when there are none. */
export function averageProgress(plans: PlanLike[]): number {
  const live = plansInProgress(plans);
  if (live.length === 0) return 0;
  return Math.round(live.reduce((sum, p) => sum + (Number.isFinite(p.progress) ? p.progress : 0), 0) / live.length);
}

export type DueLike = { id: string; title: string; due_date: string | null; status: TaskStatus };

export function isOverdue(task: DueLike, today: string): boolean {
  if (!task.due_date) return false;
  if (TERMINAL.includes(task.status)) return false;
  return task.due_date < today;
}

/** Tasks due between today and `days` ahead, soonest first. */
export function weekAhead<T extends DueLike>(tasks: T[], today: string, days = 7): T[] {
  const end = new Date(`${today}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + days);
  const endIso = end.toISOString().slice(0, 10);
  return tasks
    .filter((t) => t.due_date && !TERMINAL.includes(t.status) && t.due_date >= today && t.due_date <= endIso)
    .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));
}
