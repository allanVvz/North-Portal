export type MetricDef = { key: string; label: string; unit?: string };

// Metrics that can realistically come from a Meta (Instagram/Facebook) Ads
// integration later come first — that's the primary source of performance
// data for this platform. "Agendamentos" (appointment bookings) is a
// secondary, manual-only metric today (the platform doesn't ingest booking
// counts directly yet) — kept last on purpose, not as a headline metric.
export const METRIC_DEFS: MetricDef[] = [
  { key: "alcance", label: "Alcance", unit: "pessoas" },
  { key: "impressoes", label: "Impressões" },
  { key: "cliques", label: "Cliques" },
  { key: "ctr", label: "CTR", unit: "%" },
  { key: "engajamento", label: "Engajamento" },
  { key: "custo", label: "Custo", unit: "R$" },
  { key: "cpc", label: "Custo por clique", unit: "R$" },
  { key: "conversoes", label: "Conversões" },
  { key: "agendamentos", label: "Agendamentos", unit: "secundária" },
];
