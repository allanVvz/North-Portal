// Seção "Resultados por campanha" — KPIs agrupados por BLOCO DE OBJETIVO
// (tráfego site / tráfego perfil / mensagens / engajamento / outro).
//
// Extraído de adsReportPdf.tsx sem mudança de comportamento para ser
// compartilhado com salesReportPdf.tsx: o relatório de vendas passou a fechar a
// semana com a mesma leitura por objetivo do relatório de anúncios, mais a
// camada de conversão/ROAS por fonte.
//
// O bloco de cada campanha vem de `config.campaignBlocks` (tag manual no
// template); `suggestCampaignBlock` só como palpite quando a campanha não foi
// taggeada.

import { Text, View } from "@react-pdf/renderer";
import { ratio, resolveAcquisitionMetric } from "@/app/admin/performance/acquisitionInsights";
import { isNotIntegrated } from "@/app/admin/performance/insights";
import { metricRefInverse, metricRefKind } from "@/app/admin/performance/performanceLabels";
import {
  CAMPAIGN_BLOCKS, CAMPAIGN_BLOCK_LABEL, suggestCampaignBlock,
  type CampaignBlock, type PerformanceTemplateConfig,
} from "@/lib/performanceTemplates";
import type { MetricRef } from "@/lib/performancePrefs";
import type { MetaPost } from "@/lib/windsor";
import { KpiCard, REPORT_STYLES as S } from "./reportComponents";

type BlockKpi = { label: string; metric?: MetricRef; ratio?: [MetricRef, MetricRef] };

// "Mensagens" (metric `contatos`) entra em TODO bloco: "alguém chamou" é o
// desfecho que a equipe conta, independente do objetivo da campanha. "Visitas ao
// perfil" (`profileVisits`, ingerido de instagram_profile_visits) entra onde faz
// sentido. "Novos seguidores" fica zerado — a Meta não expõe follows na API.
export const BLOCK_KPIS: Record<CampaignBlock, BlockKpi[]> = {
  trafego_site: [
    { label: "Investimento", metric: "custo" },
    { label: "Alcance", metric: "alcance" },
    { label: "Cliques no site", metric: "cliquesLink" },
    { label: "Visitas ao perfil", metric: "profileVisits" },
    { label: "Mensagens", metric: "contatos" },
    { label: "Custo por clique", ratio: ["custo", "cliquesLink"] },
  ],
  trafego_perfil: [
    { label: "Investimento", metric: "custo" },
    { label: "Alcance", metric: "alcance" },
    { label: "Visitas ao perfil", metric: "profileVisits" },
    { label: "Mensagens", metric: "contatos" },
    { label: "Custo por visita", ratio: ["custo", "profileVisits"] },
  ],
  mensagens: [
    { label: "Investimento", metric: "custo" },
    { label: "Alcance", metric: "alcance" },
    { label: "Mensagens", metric: "contatos" },
    { label: "Custo por mensagem", ratio: ["custo", "contatos"] },
  ],
  engajamento: [
    { label: "Investimento", metric: "custo" },
    { label: "Alcance", metric: "alcance" },
    { label: "Engajamento", metric: "engajamento" },
    { label: "Visitas ao perfil", metric: "profileVisits" },
    { label: "Mensagens", metric: "contatos" },
    { label: "Custo por engajamento", ratio: ["custo", "engajamento"] },
  ],
  outro: [
    { label: "Investimento", metric: "custo" },
    { label: "Alcance", metric: "alcance" },
    { label: "Cliques", metric: "cliques" },
    { label: "Mensagens", metric: "contatos" },
    { label: "CTR", metric: "ctr" },
  ],
};

// Métricas que o relatório força a "0" em vez de "—"/"Sem integração": são
// contagens onde zero é informação real numa conta Meta paga — hoje só
// `contatos` (msg/lead/conversa unificados). `followersGained` NÃO entra: a Meta
// não entrega follows na API, então uma etapa "seguidores" zerada aqui era só
// ruído — seguidores ganhos são relatados no comentário e entram no relatório de
// vendas.
export const ZERO_NOT_DASH = new Set<MetricRef>(["contatos"]);

/** Resolve o bloco de objetivo de uma campanha: tag manual do template primeiro,
 *  palpite pelo objetivo/nome só como fallback. */
export function blockResolver(config: PerformanceTemplateConfig) {
  const blockOf = (
    campaignId: string | undefined,
    campaignName: string | undefined,
    objective?: string,
    optimizationGoal?: string,
  ): CampaignBlock =>
    config.campaignBlocks[campaignId ?? campaignName ?? ""] ??
    suggestCampaignBlock(objective, optimizationGoal, campaignName);
  const postBlock = (p: MetaPost) =>
    blockOf(p.campaignId, p.campaignName ?? p.caption, p.objective, p.optimizationGoal);
  return { blockOf, postBlock };
}

function kpiForDef(
  def: BlockKpi,
  cur: MetaPost[],
  prev: MetaPost[],
  cm: PerformanceTemplateConfig["prefs"]["customMetrics"],
) {
  if (def.ratio) {
    const [num, den] = def.ratio;
    return {
      label: def.label,
      value: ratio(resolveAcquisitionMetric(cur, num, cm), resolveAcquisitionMetric(cur, den, cm)),
      previous: ratio(resolveAcquisitionMetric(prev, num, cm), resolveAcquisitionMetric(prev, den, cm)),
      kind: "money" as const,
      inverse: true,
      notIntegrated: false,
    };
  }
  const ref = def.metric as MetricRef;
  const zero = ZERO_NOT_DASH.has(ref);
  return {
    label: def.label,
    value: resolveAcquisitionMetric(cur, ref, cm) ?? (zero ? 0 : null),
    previous: resolveAcquisitionMetric(prev, ref, cm) ?? (zero ? 0 : null),
    kind: metricRefKind(ref, cm),
    inverse: metricRefInverse(ref, cm),
    notIntegrated: zero ? false : isNotIntegrated(ref, cm),
  };
}

/** A seção inteira. `posts`/`prevPosts` são posts em nível de CAMPANHA. Não
 *  renderiza nada quando nenhuma campanha tem dado no período. */
export function CampaignBlocksSection({
  config,
  posts,
  prevPosts,
  kicker = "Resultados por campanha",
}: {
  config: PerformanceTemplateConfig;
  posts: MetaPost[];
  prevPosts: MetaPost[];
  kicker?: string;
}) {
  const cm = config.prefs.customMetrics;
  const { postBlock } = blockResolver(config);
  const blocksPresent = CAMPAIGN_BLOCKS.filter((block) => posts.some((p) => postBlock(p) === block));
  if (!blocksPresent.length) return null;

  return (
    <View style={S.section}>
      <Text style={S.kicker}>{kicker}</Text>
      {blocksPresent.map((block) => {
        const cur = posts.filter((p) => postBlock(p) === block);
        const prev = prevPosts.filter((p) => postBlock(p) === block);
        return (
          <View style={S.blockGroup} key={block} wrap={false}>
            <View style={S.blockHead}>
              <Text style={S.blockTitle}>{CAMPAIGN_BLOCK_LABEL[block]}</Text>
            </View>
            <View style={S.grid}>
              {BLOCK_KPIS[block].map((def) => <KpiCard key={def.label} {...kpiForDef(def, cur, prev, cm)} />)}
            </View>
          </View>
        );
      })}
    </View>
  );
}
