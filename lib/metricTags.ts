// Catálogo das métricas (tags) que a automação `relatorio_conversao` lê do
// comentário do gestor. É deliberadamente aberto: a config guarda uma lista de
// strings livres; as tags conhecidas abaixo só dão rótulo bonito e dizem se o
// número é contagem ou dinheiro. Uma tag fora da lista funciona igual —
// vira só um número em `task_metrics`.

export type MetricTagKind = "count" | "money";
export type MetricTagDef = { key: string; label: string; kind: MetricTagKind };

// `seguidores` é SNAPSHOT (o total do perfil ao fim do período), não o ganho
// da semana — de dois snapshots dá pra derivar o ganho, do ganho sozinho não
// dá pra reconstruir o total, e a série temporal (task_metrics.period_to)
// precisa de uma grandeza só. O rótulo diz "total" para o gestor responder a
// coisa certa já no comentário. Ver a regra correspondente em
// lib/ai/extractMetrics.ts.
export const KNOWN_METRIC_TAGS: MetricTagDef[] = [
  { key: "vendas", label: "Vendas", kind: "count" },
  { key: "agendamentos", label: "Agendamentos", kind: "count" },
  { key: "seguidores", label: "Seguidores (total do perfil)", kind: "count" },
  { key: "receita", label: "Receita", kind: "money" },
  // A Marketing API não entrega verba restante junto com os insights, e a
  // operação precisa do número no resumo semanal. Em vez de um card vazio no
  // relatório, a automação PEDE no comentário — mesma via de vendas e receita.
  // Fora do default de propósito: só quem acompanha verba adiciona a tag.
  { key: "verba_disponivel", label: "Verba disponível", kind: "money" },
];

/** Default quando a automação não tem `collect_metric_keys` preenchido.
 *  `verba_disponivel` fica de fora: é pedido só para quem configurou a tag, para
 *  não cobrar de todo cliente um número que nem toda operação acompanha. */
export const CONVERSION_METRICS_DEFAULT: string[] = KNOWN_METRIC_TAGS
  .filter((t) => t.key !== "verba_disponivel")
  .map((t) => t.key);

/** Métricas que NENHUMA integração preenche — só chegam pelo comentário. O
 *  relatório usa isto para não exibir um card "sem integração" onde o número, na
 *  verdade, é responsabilidade de quem responde o feedback. */
export const COMMENT_ONLY_METRIC_TAGS = new Set<string>(["seguidores", "verba_disponivel"]);

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
