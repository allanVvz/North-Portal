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
import type { ReactNode } from "react";
import { ratio, resolveAcquisitionMetric } from "@/app/admin/performance/acquisitionInsights";
import { isNotIntegrated } from "@/app/admin/performance/insights";
import { metricRefInverse, metricRefKind } from "@/app/admin/performance/performanceLabels";
import {
  CAMPAIGN_BLOCKS, CAMPAIGN_BLOCK_LABEL, suggestCampaignBlock,
  type BlockKpiDef, type CampaignBlock, type PerformanceTemplateConfig,
} from "@/lib/performanceTemplates";
import type { MetricRef } from "@/lib/performancePrefs";
import type { MetaPost } from "@/lib/windsor";
import { KpiCard, REPORT_STYLES as S } from "./reportComponents";

// Mesma forma que o template declara — um alias, para as duas não divergirem.
type BlockKpi = BlockKpiDef;

// "Mensagens" (metric `contatos`) entra em TODO bloco: "alguém chamou" é o
// desfecho que a equipe conta, independente do objetivo da campanha. "Visitas ao
// perfil" (`profileVisits`, ingerido de instagram_profile_visits) entra onde faz
// sentido. "Novos seguidores" fica zerado — a Meta não expõe follows na API.
export const BLOCK_KPIS_DEFAULT: Record<CampaignBlock, BlockKpi[]> = {
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

/** Os KPIs de um bloco: o que o template do cliente declarou, ou o conjunto
 *  padrão acima. É este ponto que faz o molde ser "por cliente" — a lista e os
 *  rótulos saem do template, não do código. Um bloco não declarado cai no padrão,
 *  para uma campanha inesperada nunca sair sem números. */
export function blockKpisOf(config: PerformanceTemplateConfig, block: CampaignBlock): BlockKpi[] {
  // Operational templates are allow-lists.  Falling back to the generic
  // collection here would let an unexpected campaign surface clicks, CTR or
  // other data that was never part of the client summary.
  return config.reportKpiPolicy === "generic"
    ? config.blockKpis[block] ?? BLOCK_KPIS_DEFAULT[block]
    : config.blockKpis[block] ?? [];
}

/** Classifica uma evidência isolada, sem deixar o nome da campanha vazar para
 * uma etapa anterior da precedência. `outro` significa "evidência inconclusiva"
 * aqui; uma classificação manual explícita como `outro` continua soberana. */
function inferredBlock(objective?: string, optimizationGoal?: string): CampaignBlock | null {
  const block = suggestCampaignBlock(objective, optimizationGoal);
  return block === "outro" ? null : block;
}

/** Resolve o bloco de objetivo por evidência, nesta ordem estrita:
 * configuração manual > goal dos anúncios > goal da campanha > objective >
 * nome. PROFILE_VISIT nos anúncios vence LINK_CLICKS da campanha. */
export function blockResolver(config: PerformanceTemplateConfig, ads: MetaPost[] = []) {
  const adsByCampaign = new Map<string, MetaPost[]>();
  for (const ad of ads) {
    const aliases = new Set(
      [ad.campaignId, ad.campaignName, ad.campaignName ? undefined : ad.caption]
        .filter((value): value is string => Boolean(value)),
    );
    for (const key of aliases) {
      const group = adsByCampaign.get(key) ?? [];
      group.push(ad);
      adsByCampaign.set(key, group);
    }
  }

  const blockOf = (
    campaignId: string | undefined,
    campaignName: string | undefined,
    objective?: string,
    optimizationGoal?: string,
  ): CampaignBlock => {
    const explicit = (campaignId ? config.campaignBlocks[campaignId] : undefined)
      ?? (campaignName ? config.campaignBlocks[campaignName] : undefined);
    if (explicit) return explicit;

    const associated = new Set([
      ...(campaignId ? adsByCampaign.get(campaignId) ?? [] : []),
      ...(campaignName && campaignName !== campaignId ? adsByCampaign.get(campaignName) ?? [] : []),
    ]);
    const adGoals = [...new Set(
      [...associated].map((ad) => ad.optimizationGoal).filter((goal): goal is string => Boolean(goal)),
    )];
    const profileGoal = adGoals.find((goal) => inferredBlock(undefined, goal) === "trafego_perfil");
    if (profileGoal) return "trafego_perfil";
    for (const goal of adGoals) {
      const inferred = inferredBlock(undefined, goal);
      if (inferred) return inferred;
    }
    const byCampaignGoal = inferredBlock(undefined, optimizationGoal);
    if (byCampaignGoal) return byCampaignGoal;
    const byObjective = inferredBlock(objective);
    if (byObjective) return byObjective;
    return suggestCampaignBlock(undefined, undefined, campaignName);
  };
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

type KpiProps = Parameters<typeof KpiCard>[0];

/** A seção inteira. `posts`/`prevPosts` são posts em nível de CAMPANHA. Não
 *  renderiza nada quando nenhuma campanha tem dado no período.
 *
 *  `extraKpis` — cards acrescentados ao final do bloco (o relatório de vendas
 *  usa para pendurar a conversão/ROAS por objetivo); `footer` — nota abaixo da
 *  seção. Nenhum dos dois muda o relatório de anúncios, que não os passa. */
export function CampaignBlocksSection({
  config,
  posts,
  prevPosts,
  adPosts = [],
  kicker = "Resultados por campanha",
  extraKpis,
  detail,
  footer,
}: {
  config: PerformanceTemplateConfig;
  posts: MetaPost[];
  prevPosts: MetaPost[];
  /** Posts de nível de ANÚNCIO. Sem eles o `optimization_goal` do adset não
   *  chega ao resolvedor, e é ele que distingue uma campanha de perfil
   *  (PROFILE_VISIT) de uma de site — no nível de campanha a Meta só diz
   *  LINK_CLICKS. Omitir este argumento fazia o bloco "Tráfego para o perfil"
   *  desaparecer do relatório. */
  adPosts?: MetaPost[];
  kicker?: string;
  extraKpis?: (block: CampaignBlock, cur: MetaPost[], prev: MetaPost[]) => KpiProps[];
  /** Conteúdo específico do objetivo, renderizado logo após seus KPIs. */
  detail?: (block: CampaignBlock, cur: MetaPost[], prev: MetaPost[]) => ReactNode;
  footer?: string;
}) {
  const cm = config.prefs.customMetrics;
  const { postBlock } = blockResolver(config, adPosts);
  const blocksPresent = CAMPAIGN_BLOCKS.filter((block) =>
    posts.some((p) => postBlock(p) === block) && blockKpisOf(config, block).length,
  );
  if (!blocksPresent.length) return null;

  return (
    <View style={S.section}>
      <Text style={S.kicker}>{kicker}</Text>
      {blocksPresent.map((block) => {
        const cur = posts.filter((p) => postBlock(p) === block);
        const prev = prevPosts.filter((p) => postBlock(p) === block);
        const extra = extraKpis?.(block, cur, prev) ?? [];
        const detailContent = detail?.(block, cur, prev) ?? null;
        return (
          <View style={S.blockGroup} key={block} wrap={!detailContent ? false : true}>
            <View style={S.blockHead}>
              <Text style={S.blockTitle}>{CAMPAIGN_BLOCK_LABEL[block]}</Text>
            </View>
            <View style={S.grid}>
              {blockKpisOf(config, block).map((def) => <KpiCard key={def.label} {...kpiForDef(def, cur, prev, cm)} />)}
              {extra.map((k) => <KpiCard key={k.label} {...k} />)}
            </View>
            {detailContent}
          </View>
        );
      })}
      {footer ? <Text style={S.empty}>{footer}</Text> : null}
    </View>
  );
}
