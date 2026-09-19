// O foco do relatório de resultados — puro, sem PDF.
//
// O relatório mostra mídia E conversão, mas a hierarquia muda com a conversão
// mais importante que o cliente INFORMOU: venda/receita > agendamento >
// seguidor. Não é o mesmo template com números trocados: cada modo tem figura
// principal, figuras de apoio, funil, histórico e análises próprios.
// Plano: docs/reporting/adaptive-report-plan.md §3–§9.

import { formatAcquisitionValue } from "@/app/admin/performance/acquisitionInsights";
import type { Attribution, InformedTotals } from "./conversionMode";
import { salesHeadline } from "./salesHeadline";
import {
  deltaOf, mediaFunnel, money, num, pctChange, pctRound, pctText, signed, stageGap,
  type Delta, type FunnelStage, type MediaTotals,
} from "./adsInsights";

export type FocusKind = "vendas" | "agendamentos" | "seguidores" | "midia";

export function focusOf(t: InformedTotals): FocusKind {
  if (t.vendas !== null || t.receita !== null) return "vendas";
  if (t.agendamentos !== null) return "agendamentos";
  if (t.seguidores !== null || t.seguidoresGanho != null) return "seguidores";
  return "midia";
}

export const FOCUS_LABEL: Record<FocusKind, string> = {
  vendas: "Vendas",
  agendamentos: "Agendamentos",
  seguidores: "Seguidores",
  midia: "Mídia",
};

export type FocusContext = {
  kind: FocusKind;
  cur: InformedTotals;
  prev: InformedTotals | null;
  media: MediaTotals;
  prevMedia: MediaTotals | null;
  /** total atual − total anterior; null sem semana anterior. */
  followersGain: number | null;
  prevFollowersGain: number | null;
  prevFollowersTotal: number | null;
};

const none: Delta = { pct: null, tone: "neutral", text: "sem semana anterior" };
const up = (c: number | null, p: number | null | undefined) => (p === undefined || p === null ? none : deltaOf(c, p, "higher_is_better"));
const down = (c: number | null, p: number | null | undefined) => (p === undefined || p === null ? none : deltaOf(c, p, "lower_is_better"));

function signedPct(value: number): string {
  return `${value >= 0 ? "+" : "−"}${pctText(value)}`;
}

function followerTotalHint(current: number | null, previous: number | null): string | undefined {
  if (current === null) return undefined;
  if (previous === null) return `${num(current)} no perfil; semana anterior não informada`;
  const difference = current - previous;
  const percentage = pctChange(current, previous);
  return `era ${num(previous)} · ${signed(difference)} (${percentage === null ? "sem base percentual" : signedPct(percentage)}) vs semana anterior`;
}

// ---- figura principal ---------------------------------------------------------------

export type Hero = { label: string; value: string; caption: string; delta: Delta | null };

export function heroFor(x: FocusContext): Hero {
  const { cur, prev, media } = x;
  if (x.kind === "vendas") {
    if (cur.receita !== null) {
      return {
        label: "Receita da semana",
        value: money(cur.receita),
        caption: [cur.vendas !== null ? `${num(cur.vendas)} ${cur.vendas === 1 ? "venda fechada" : "vendas fechadas"}` : null, cur.agendamentos !== null ? `${num(cur.agendamentos)} agendamentos` : null].filter(Boolean).join(" · "),
        delta: prev?.receita != null ? up(cur.receita, prev.receita) : null,
      };
    }
    return {
      label: "Vendas fechadas",
      value: num(cur.vendas),
      caption: cur.agendamentos !== null ? `${num(cur.agendamentos)} agendamentos na semana` : "",
      delta: prev?.vendas != null ? up(cur.vendas, prev.vendas) : null,
    };
  }
  if (x.kind === "agendamentos") {
    return { label: "Agendamentos", value: num(cur.agendamentos), caption: media.conversations !== null ? `${num(media.conversations)} conversas pela mídia` : "", delta: prev?.agendamentos != null ? up(cur.agendamentos, prev.agendamentos) : null };
  }
  if (x.kind === "seguidores") {
    if (x.followersGain !== null && x.cur.seguidores !== null && x.prevFollowersTotal !== null) {
      const growth = pctChange(cur.seguidores, x.prevFollowersTotal);
      return {
        label: "crescimento de seguidores",
        value: signed(x.followersGain),
        caption: `Total do perfil: ${num(cur.seguidores)}. Diferença para a semana anterior: ${signed(x.followersGain)} (${growth === null ? "sem base percentual" : signedPct(growth)}), quando eram ${num(x.prevFollowersTotal)}.`,
        delta: null,
      };
    }
    if (x.followersGain !== null) {
      const comparison = x.prevFollowersGain !== null
        ? `Comparação com o período anterior: ${signed(x.followersGain - x.prevFollowersGain)} (${x.prevFollowersGain === 0 ? "sem base percentual" : `${x.followersGain >= x.prevFollowersGain ? "+" : "−"}${pctText(((x.followersGain - x.prevFollowersGain) / x.prevFollowersGain) * 100)}`}).`
        : "Total do perfil não informado; o valor acima é o ganho declarado no feedback.";
      return { label: "seguidores ganhos na semana", value: signed(x.followersGain), caption: comparison, delta: null };
    }
    return { label: "seguidores no perfil", value: num(cur.seguidores), caption: "Primeira semana registrada — o crescimento aparece a partir da próxima.", delta: null };
  }
  return { label: "conversas pela mídia", value: num(media.conversations), caption: media.spend !== null ? `${money(media.spend)} investidos na semana` : "", delta: x.prevMedia ? up(media.conversations, x.prevMedia.conversations) : null };
}

// ---- figuras de apoio ------------------------------------------------------------------

export type Figure = { label: string; value: string; delta: Delta | null; hint?: string };

export function supportFigures(x: FocusContext): Figure[] {
  const { cur, prev, media, prevMedia } = x;
  const out: Figure[] = [];
  const spendDelta = prevMedia?.spend != null ? deltaOf(media.spend, prevMedia.spend, "neutral") : null;
  if (x.kind === "vendas") {
    if (cur.receita !== null && cur.vendas !== null) out.push({ label: "Vendas fechadas", value: num(cur.vendas), delta: prev?.vendas != null ? up(cur.vendas, prev.vendas) : null });
    if (cur.agendamentos !== null) out.push({ label: "Agendamentos", value: num(cur.agendamentos), delta: prev?.agendamentos != null ? up(cur.agendamentos, prev.agendamentos) : null });
    if (cur.receita !== null && cur.vendas) {
      const t = cur.receita / cur.vendas;
      const pt = prev?.receita != null && prev?.vendas ? prev.receita / prev.vendas : null;
      out.push({ label: "Ticket médio", value: money(t), delta: pt !== null ? up(t, pt) : null });
    }
    if (media.spend && cur.vendas) {
      const c = media.spend / cur.vendas;
      const pc = prevMedia?.spend && prev?.vendas ? prevMedia.spend / prev.vendas : null;
      out.push({ label: "Custo de mídia por venda", value: money(c), delta: pc !== null ? down(c, pc) : null });
    }
    if (cur.seguidores !== null) {
      out.push({ label: "Seguidores no perfil", value: num(cur.seguidores), delta: null, hint: followerTotalHint(cur.seguidores, x.prevFollowersTotal) });
    } else if (x.followersGain !== null) {
      out.push({ label: "Seguidores novos", value: signed(x.followersGain), delta: null, hint: x.prevFollowersGain === null ? "total do perfil não informado" : `eram ${num(x.prevFollowersGain)} na semana anterior` });
    }
  } else if (x.kind === "agendamentos") {
    if (media.conversations !== null) out.push({ label: "Conversas", value: num(media.conversations), delta: prevMedia ? up(media.conversations, prevMedia.conversations) : null });
    if (media.spend && cur.agendamentos) out.push({ label: "Custo de mídia por agendamento", value: money(media.spend / cur.agendamentos), delta: null });
    if (cur.seguidores !== null) {
      out.push({ label: "Seguidores no perfil", value: num(cur.seguidores), delta: null, hint: followerTotalHint(cur.seguidores, x.prevFollowersTotal) });
    } else if (x.followersGain !== null) {
      out.push({ label: "Seguidores novos", value: signed(x.followersGain), delta: null, hint: x.prevFollowersGain === null ? "total do perfil não informado" : `eram ${num(x.prevFollowersGain)} na semana anterior` });
    }
  } else if (x.kind === "seguidores") {
    if (cur.seguidores !== null) out.push({ label: "Seguidores no perfil", value: num(cur.seguidores), delta: null, hint: followerTotalHint(cur.seguidores, x.prevFollowersTotal) });
    if (media.profileVisits !== null) out.push({ label: "Visitas ao perfil", value: num(media.profileVisits), delta: prevMedia ? up(media.profileVisits, prevMedia.profileVisits) : null });
    if (media.spend && media.profileVisits) {
      const c = media.spend / media.profileVisits;
      const pc = prevMedia?.spend && prevMedia.profileVisits ? prevMedia.spend / prevMedia.profileVisits : null;
      out.push({ label: "Custo por visita", value: money(c), delta: pc !== null ? down(c, pc) : null });
    }
  } else {
    if (media.reach !== null) out.push({ label: "Alcance", value: num(media.reach), delta: prevMedia ? up(media.reach, prevMedia.reach) : null });
    if (media.costPerConversation !== null) out.push({ label: "Custo por conversa", value: money(media.costPerConversation), delta: prevMedia ? down(media.costPerConversation, prevMedia.costPerConversation) : null });
  }
  if (media.spend !== null && out.length < 4) out.push({ label: "Investimento", value: money(media.spend), delta: spendDelta });
  return out.slice(0, 4);
}

// ---- funil -------------------------------------------------------------------------------

export type ResultFunnel = { stages: FunnelStage[]; gaps: string[] };

export function resultFunnel(x: FocusContext): ResultFunnel {
  const { cur, media } = x;
  let stages: FunnelStage[];
  if (x.kind === "seguidores") {
    stages = mediaFunnel(media, "visitas");
    if (x.followersGain !== null && x.followersGain > 0) stages.push({ key: "seguidores_novos", label: "Seguidores novos", value: x.followersGain, source: "feedback" });
    if (cur.seguidores !== null) stages.push({ key: "total_perfil", label: "Total do perfil", value: cur.seguidores, source: "feedback", base: true });
  } else {
    stages = mediaFunnel(media, "conversas");
    if ((x.kind === "vendas" || x.kind === "agendamentos") && cur.agendamentos !== null) stages.push({ key: "agendamentos", label: "Agendamentos", value: cur.agendamentos, source: "feedback" });
    if (x.kind === "vendas" && cur.vendas !== null) stages.push({ key: "vendas", label: "Vendas", value: cur.vendas, source: "feedback" });
  }
  return { stages, gaps: stages.slice(1).map((s, i) => stageGap(stages[i], s)) };
}

// ---- escada de custo -----------------------------------------------------------------------

export type CostStep = { label: string; value: string };

export function costLadder(spend: number | null, conversations: number | null, t: InformedTotals): CostStep[] {
  if (spend === null || spend <= 0) return [];
  const steps: CostStep[] = [];
  if (conversations) steps.push({ label: "por conversa", value: money(spend / conversations) });
  if (t.agendamentos) steps.push({ label: "por agendamento", value: money(spend / t.agendamentos) });
  if (t.vendas) steps.push({ label: "por venda", value: money(spend / t.vendas) });
  return steps;
}

// ---- histórico -------------------------------------------------------------------------------

export type HistoryPoint = {
  periodTo: string;
  vendas: number | null;
  agendamentos: number | null;
  receita: number | null;
  seguidores: number | null;
  seguidoresGanho?: number | null;
};

export type HistorySeries = { key: string; label: string; values: (number | null)[] };

export type HistoryView =
  | { type: "none" }
  | { type: "comparison"; items: { label: string; from: string; to: string; change: string; tone: "good" | "bad" | "neutral" }[] }
  | { type: "chart"; form: "line" | "columns"; title: string; periods: string[]; series: HistorySeries[]; summary: string | null };

const shortDay = (iso: string) => iso.slice(5).split("-").reverse().join("/");

/** 1 ponto: nada. 2: comparação "antes → depois". 3+: gráfico (linha para total de
 *  seguidores, colunas para contagens semanais). */
export function historyView(kind: FocusKind, points: HistoryPoint[]): HistoryView {
  const ordered = [...points].sort((a, b) => a.periodTo.localeCompare(b.periodTo)).slice(-8);
  const keys: { key: keyof HistoryPoint; label: string; money?: boolean }[] =
    kind === "vendas" ? [{ key: "receita", label: "Receita", money: true }, { key: "vendas", label: "Vendas" }, { key: "agendamentos", label: "Agendamentos" }]
      : kind === "agendamentos" ? [{ key: "agendamentos", label: "Agendamentos" }]
        : kind === "seguidores" ? [{ key: "seguidores", label: "Seguidores no perfil" }]
          : [];
  const present = keys.filter((k) => ordered.filter((p) => p[k.key] !== null).length >= 2);
  if (!present.length) return { type: "none" };
  const n = Math.max(...present.map((k) => ordered.filter((p) => p[k.key] !== null).length));

  if (n === 2) {
    return {
      type: "comparison",
      items: present.map((k) => {
        const vals = ordered.map((p) => p[k.key] as number | null).filter((v): v is number => v !== null);
        const [a, b] = vals.slice(-2);
        const fmt = (v: number) => (k.money ? money(v) : num(v));
        const diff = b - a;
        return { label: k.label, from: fmt(a), to: fmt(b), change: k.money ? `${diff >= 0 ? "+" : "−"}${money(Math.abs(diff))}` : signed(diff), tone: diff > 0 ? "good" : diff < 0 ? "bad" : "neutral" };
      }),
    };
  }

  if (kind === "seguidores") {
    const totals = ordered.map((p) => p.seguidores);
    const firstIdx = totals.findIndex((v) => v !== null);
    const last = [...totals].reverse().find((v) => v !== null) ?? null;
    const first = firstIdx >= 0 ? totals[firstIdx] : null;
    const weeks = totals.filter((v) => v !== null).length - 1;
    return {
      type: "chart",
      form: "line",
      title: "Evolução do perfil",
      periods: ordered.map((p) => shortDay(p.periodTo)),
      series: [{ key: "seguidores", label: "Seguidores no perfil", values: totals }],
      summary: first !== null && last !== null ? `${signed(last - first)} seguidores em ${weeks} semanas` : null,
    };
  }
  return {
    type: "chart",
    form: "columns",
    title: kind === "vendas" ? "Agendamentos e vendas por semana" : "Agendamentos por semana",
    periods: ordered.map((p) => shortDay(p.periodTo)),
    series: present.filter((k) => !k.money).map((k) => ({ key: String(k.key), label: k.label, values: ordered.map((p) => p[k.key] as number | null) })),
    summary: null,
  };
}

// ---- manchete e análises --------------------------------------------------------------------

export type ResultAnalysisInput = FocusContext & {
  attribution: Attribution;
  topCreative: { name: string; clicks: number; conversations: number; spend: number } | null;
};

export function resultAnalysis(x: ResultAnalysisInput): { headline: string; insights: string[] } {
  const { cur, prev, media, prevMedia } = x;
  const out: string[] = [];

  if (x.kind === "seguidores") {
    const headline = x.followersGain !== null ? `${signed(x.followersGain)} seguidores na semana.` : `${num(cur.seguidores)} seguidores no perfil.`;
    const dReach = prevMedia ? pctChange(media.reach, prevMedia.reach) : null;
    const dVisits = prevMedia ? pctChange(media.profileVisits, prevMedia.profileVisits) : null;
    if (dReach !== null && dVisits !== null && dReach <= -10 && Math.abs(dVisits) < 10) {
      out.push(`Mesmo com alcance ${pctRound(dReach)} menor, as visitas ao perfil ficaram próximas da semana anterior.`);
    } else if (dVisits !== null && dVisits >= 10) {
      out.push(`As visitas ao perfil cresceram ${pctRound(dVisits)} em relação à semana anterior.`);
    }
    if (x.followersGain !== null && x.prevFollowersGain !== null && x.prevFollowersGain > 0) {
      const d = pctChange(x.followersGain, x.prevFollowersGain) ?? 0;
      out.push(Math.abs(d) < 5 ? `O ritmo de crescimento se manteve: ${signed(x.prevFollowersGain)} na semana anterior.` : d > 0 ? `O ganho superou o da semana anterior (${signed(x.prevFollowersGain)}).` : `O ganho ficou abaixo do da semana anterior (${signed(x.prevFollowersGain)}).`);
    }
    if (media.spend && x.followersGain && x.followersGain > 0) out.push(`Cada seguidor novo custou em média ${money(media.spend / x.followersGain)} de mídia.`);
    if (x.topCreative) out.push(`${x.topCreative.name} foi o anúncio que mais levou gente ao perfil.`);
    return { headline, insights: out.slice(0, 3) };
  }

  if (x.kind === "vendas" || x.kind === "agendamentos") {
    const headline = salesHeadline({
      receita: cur.receita, vendas: cur.vendas, agendamentos: cur.agendamentos, seguidoresGanho: x.followersGain,
      prev: prev ? { receita: prev.receita, vendas: prev.vendas } : null,
    });
    if (cur.agendamentos && cur.vendas !== null) out.push(`${pctText((cur.vendas / cur.agendamentos) * 100)} dos agendamentos viraram venda.`);
    const origins = Object.entries(x.attribution.porFonte).sort((a, b) => b[1]!.vendas - a[1]!.vendas);
    if (origins.length && x.attribution.comOrigem > 0) {
      const [fonte, t] = origins[0];
      out.push(`A fonte #${fonte} trouxe ${num(t!.vendas)} das ${num(x.attribution.comOrigem)} vendas com origem${t!.receita !== null ? ` (${money(t!.receita)})` : ""}.`);
    }
    if (media.spend && cur.vendas) {
      const c = media.spend / cur.vendas;
      const pc = prevMedia?.spend && prev?.vendas ? prevMedia.spend / prev.vendas : null;
      const d = pctChange(c, pc);
      out.push(`Cada venda custou ${money(c)} de mídia${d !== null && Math.abs(d) >= 5 ? `, ${pctRound(d)} ${d < 0 ? "a menos" : "a mais"} que na semana anterior` : ""}.`);
    }
    if (x.topCreative && x.topCreative.conversations > 0) out.push(`${x.topCreative.name} gerou a maior parte das conversas da semana.`);
    return { headline, insights: out.slice(0, 3) };
  }

  return { headline: "Sem resultado comercial registrado nesta semana.", insights: media.conversations !== null ? [`A mídia gerou ${num(media.conversations)} conversas no período.`] : [] };
}

export const formatMoney = money;
export const formatPct = (v: number) => formatAcquisitionValue(v, "decimal");
