"use client";

import { useEffect, useState } from "react";
import type { ClientInsight } from "@/lib/insights/clientInsights";

/** Os dados de relatório de todos os clientes, lidos uma vez por página. */
export function useClientInsights(slug?: string) {
  const [insights, setInsights] = useState<ClientInsight[] | null>(null);
  useEffect(() => {
    let active = true;
    fetch(`/api/admin/insights/clients?weeks=8${slug ? `&slug=${encodeURIComponent(slug)}` : ""}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data: { insights: ClientInsight[] }) => { if (active) setInsights(data.insights); })
      .catch(() => { if (active) setInsights([]); });
    return () => { active = false; };
  }, [slug]);
  return insights;
}

export const money = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
export const compact = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : value.toLocaleString("pt-BR", { notation: value >= 10000 ? "compact" : "standard", maximumFractionDigits: 1 });

/** Variação percentual entre duas semanas, ou null sem base. */
export function delta(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current === null || current === undefined || !previous) return null;
  return ((current - previous) / previous) * 100;
}
