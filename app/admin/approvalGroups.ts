import type { TaskRecord } from "@/lib/validation";

// Pure filters shared by the Revisões and Aprovações screens — each screen
// only ever shows cards that are, right now, sitting in its matching Kanban
// column(s), so these are the single source of truth for that mapping.
//
// Every card in "aprovacao" is client-facing (client_visible no longer gates
// this stage — see migration 20260706000004), so there is no more
// cliente/interno split here.

export function reviewQueueRows<T extends Pick<TaskRecord, "status">>(items: T[]): T[] {
  return items.filter((t) => t.status === "revisao");
}

export type ApprovalGroup = "pending" | "resolved";

export function groupApprovalQueue<T extends Pick<TaskRecord, "status">>(
  items: T[],
): Record<ApprovalGroup, T[]> {
  return {
    pending: items.filter((t) => t.status === "aprovacao"),
    resolved: items.filter((t) => t.status === "aprovado"),
  };
}

export function filterByClient<T extends { clientSlug: string }>(items: T[], clientSlug: string): T[] {
  return clientSlug ? items.filter((t) => t.clientSlug === clientSlug) : items;
}
