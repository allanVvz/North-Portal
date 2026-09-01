// Busca e preparo de dados compartilhados pelas duas automações de relatório
// (relatorio_trafego_semanal e relatorio_vendas). Extraído de run.ts para os
// dois lados importarem sem ciclo.

import {
  BUILTIN_PERFORMANCE_TEMPLATES,
  DEFAULT_BUILTIN_TEMPLATE,
  sanitizePerformanceTemplateConfig,
  type PerformanceTemplateConfig,
} from "@/lib/performanceTemplates";
import { type Period } from "@/app/admin/performance/insights";
import { fetchWindsorPosts, type MetaPost, type WindsorDatasource, type WindsorSettings } from "@/lib/windsor";
import { fetchMetaAdCreativeInsights, fetchMetaAdsInsights } from "@/lib/metaInsights";
import type { RecurringCadence } from "@/lib/validation";
import { errorMessage, type AdminClient } from "./taskAccess";
import type { ServiceMetaSettings } from "./serviceIntegrations";

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function periodForCadence(cadence: RecurringCadence, endIso: string): Period {
  const days = cadence === "semanal" ? 7 : cadence === "quinzenal" ? 14 : 30;
  const to = new Date(`${endIso}T12:00:00Z`);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  return { from: isoDay(from), to: isoDay(to) };
}

// performance_template_id é TEXT (aceita "builtin-*"), mas
// performance_templates.id é UUID. Consultar um id de builtin ali faz o Postgres
// devolver "invalid input syntax for type uuid" e derruba a execução inteira da
// automação. Por isso o id só vai ao banco quando é um UUID de verdade.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolveTemplateConfig(admin: AdminClient, templateId: string | null): Promise<PerformanceTemplateConfig> {
  const fallback = DEFAULT_BUILTIN_TEMPLATE.config;
  if (!templateId) return fallback;
  const builtin = BUILTIN_PERFORMANCE_TEMPLATES.find((t) => t.id === templateId);
  if (builtin) return builtin.config;
  if (!UUID_RE.test(templateId)) return fallback;
  const { data, error } = await admin.from("performance_templates").select("config").eq("id", templateId).limit(1);
  if (error) throw error;
  const row = data?.[0] as { config: unknown } | undefined;
  return row ? sanitizePerformanceTemplateConfig(row.config) : fallback;
}

// Teto de campanhas para o fan-out ad-level (uma chamada Meta por campanha —
// contas de produção têm 3–5, mas um limite protege contra uma conta com
// dezenas de campanhas antigas ainda ligadas).
const AD_LEVEL_CAMPAIGN_CAP = 25;

export type ReportPosts = { campaignPosts: MetaPost[]; adPosts: MetaPost[] };

export async function fetchPostsForAccount(
  account: { windsorAccountId: string | null; metaAccountId: string | null; metaAccountName: string | null },
  windsor: WindsorSettings,
  meta: ServiceMetaSettings,
  windowFrom: string,
  windowTo: string,
): Promise<ReportPosts> {
  const campaignPosts: MetaPost[] = [];
  if (account.windsorAccountId && windsor.apiKey) {
    const enabled = (Object.keys(windsor.datasources) as WindsorDatasource[]).filter((ds) => windsor.datasources[ds]);
    for (const ds of enabled) {
      const fetched = await fetchWindsorPosts(windsor.apiKey, ds, windowFrom, windowTo);
      campaignPosts.push(...fetched.filter((p) => p.accountId === account.windsorAccountId));
    }
  }

  const adPosts: MetaPost[] = [];
  if (account.metaAccountId && meta.accessToken) {
    const token = meta.accessToken;
    const acctId = account.metaAccountId;
    const acctName = account.metaAccountName ?? "";
    const fetched = await fetchMetaAdsInsights(token, acctId, acctName, windowFrom, windowTo);
    campaignPosts.push(...fetched);

    // Fan-out por criativo: só o path Meta direto tem dados de anúncio. Uma
    // falha numa campanha não derruba o relatório — o bloco daquela campanha
    // cai em "sem detalhe por criativo".
    const campaignIds = [...new Set(fetched.map((p) => p.campaignId).filter((id): id is string => Boolean(id)))].slice(0, AD_LEVEL_CAMPAIGN_CAP);
    for (const campaignId of campaignIds) {
      try {
        adPosts.push(...await fetchMetaAdCreativeInsights(token, acctId, acctName, campaignId, windowFrom, windowTo));
      } catch (error) {
        console.warn(`[automations] falha ao buscar criativos da campanha ${campaignId}:`, errorMessage(error));
      }
    }
  }
  return { campaignPosts, adPosts };
}
