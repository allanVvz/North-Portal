// Catálogo das métricas (tags) que a automação `relatorio_vendas` lê do
// comentário do gestor. É deliberadamente aberto: a config guarda uma lista de
// strings livres; as tags conhecidas abaixo só dão rótulo bonito e dizem se o
// número é contagem ou dinheiro. Uma tag fora da lista funciona igual —
// vira só um número em `task_metrics`.

export type MetricTagKind = "count" | "money";
export type MetricTagDef = { key: string; label: string; kind: MetricTagKind };

export const KNOWN_METRIC_TAGS: MetricTagDef[] = [
  { key: "vendas", label: "Vendas", kind: "count" },
  { key: "agendamentos", label: "Agendamentos", kind: "count" },
  { key: "seguidores", label: "Seguidores ganhos", kind: "count" },
  { key: "receita", label: "Receita", kind: "money" },
];

/** Default quando a automação não tem `collect_metric_keys` preenchido. */
export const CONVERSION_METRICS_DEFAULT: string[] = KNOWN_METRIC_TAGS.map((t) => t.key);

const BY_KEY = new Map(KNOWN_METRIC_TAGS.map((t) => [t.key, t]));

export function metricTagDef(key: string): MetricTagDef {
  return BY_KEY.get(key) ?? { key, label: key, kind: "count" };
}

export function metricTagLabel(key: string): string {
  return metricTagDef(key).label;
}

/** A extração rica (linhas de venda: serviço / valor / fonte #1-3 / status) só
 *  faz sentido quando o gestor detalha vendas — isto é, quando `vendas`,
 *  `receita` ou `fonte` estão entre as métricas pedidas. */
export function needsRichExtraction(tags: readonly string[]): boolean {
  return tags.some((t) => t === "vendas" || t === "receita" || t === "fonte");
}
