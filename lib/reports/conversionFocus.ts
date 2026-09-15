// O foco do relatório de resultados — puro, sem PDF.
//
// O relatório mostra mídia E conversão, mas sempre ancorado na conversão mais
// importante da jornada que o cliente INFORMOU: venda (e receita) acima de
// agendamento, agendamento acima de seguidor. É ela que ganha o número grande,
// a frase de abertura, o fim do funil e o histórico. O resto é contexto.
//
// Quando o funil atravessa fontes (conversas vêm da mídia; agendamentos e
// vendas vêm do feedback, de todos os canais), a taxa entre essas etapas é dita
// como PROPORÇÃO ("agendamentos = 35% das conversas"), nunca como passagem
// ("35% das conversas viraram agendamento") — o dado não sustenta a segunda.

import { formatAcquisitionValue } from "@/app/admin/performance/acquisitionInsights";
import type { InformedTotals } from "./conversionMode";
import { deltaOf, money, num, type Delta, type MediaTotals } from "./adsInsights";

export type FocusKind = "vendas" | "agendamentos" | "seguidores" | "midia";

export function focusOf(t: InformedTotals): FocusKind {
  if (t.vendas !== null || t.receita !== null) return "vendas";
  if (t.agendamentos !== null) return "agendamentos";
  if (t.seguidores !== null) return "seguidores";
  return "midia";
}

export const FOCUS_LABEL: Record<FocusKind, string> = {
  vendas: "Vendas",
  agendamentos: "Agendamentos",
  seguidores: "Seguidores",
  midia: "Mídia",
};

const pct = (a: number, b: number) => `${formatAcquisitionValue((a / b) * 100, "decimal")}%`;

// ---- funil da jornada -----------------------------------------------------------

export type JourneyStage = { label: string; value: number; source: "midia" | "feedback" };
export type Journey = { stages: JourneyStage[]; gaps: string[]; crossesSources: boolean };

function gapText(from: JourneyStage, to: JourneyStage): string {
  if (from.value <= 0) return "";
  const rate = pct(to.value, from.value);
  const key = `${from.label}→${to.label}`;
  switch (key) {
    case "Alcance→Cliques": return `${rate} chegaram ao clique`;
    case "Cliques→Conversas": return `${rate} viraram conversa`;
    case "Alcance→Visitas ao perfil": return `${rate} visitaram o perfil`;
    case "Agendamentos→Vendas": return `${rate} dos agendamentos viraram venda`;
    default:
      // Etapas de fontes diferentes: proporção, não passagem.
      return from.source !== to.source
        ? `${to.label.toLowerCase()} = ${rate} ${from.label === "Visitas ao perfil" ? "das visitas" : `das ${from.label.toLowerCase()}`}`
        : `${rate} seguiram adiante`;
  }
}

export function journeyFor(kind: FocusKind, media: MediaTotals, t: InformedTotals, followersGain: number | null): Journey {
  const candidates: (JourneyStage | null)[] = [];
  const m = (label: string, value: number | null): JourneyStage | null => (value === null ? null : { label, value, source: "midia" });
  const f = (label: string, value: number | null): JourneyStage | null => (value === null ? null : { label, value, source: "feedback" });

  if (kind === "seguidores") {
    candidates.push(m("Alcance", media.reach), m("Visitas ao perfil", media.profileVisits));
    if (followersGain !== null && followersGain > 0) candidates.push(f("Seguidores novos", followersGain));
  } else {
    candidates.push(m("Alcance", media.reach), m("Cliques", media.clicks), m("Conversas", media.conversations));
    if (kind === "vendas" || kind === "agendamentos") candidates.push(f("Agendamentos", t.agendamentos));
    if (kind === "vendas") candidates.push(f("Vendas", t.vendas));
  }
  const stages = candidates.filter((s): s is JourneyStage => s !== null);
  const gaps = stages.slice(1).map((s, i) => gapText(stages[i], s));
  return { stages, gaps, crossesSources: new Set(stages.map((s) => s.source)).size > 1 };
}

// ---- faixa de KPIs --------------------------------------------------------------

export type ResultKpi = { label: string; value: string; delta: Delta; hint?: string };

export type ResultKpiInput = {
  kind: FocusKind;
  cur: InformedTotals;
  prev: InformedTotals | null;
  media: MediaTotals;
  prevMedia: MediaTotals | null;
  followersGain: number | null;
  prevFollowersGain: number | null;
};

const none: Delta = { pct: null, tone: "neutral", text: "sem semana anterior" };

/** Até cinco números, a conversão principal primeiro. Só entra o que foi
 *  informado ou calculável — nada de cartão com zero por ausência. */
export function resultKpis(i: ResultKpiInput): ResultKpi[] {
  const { cur, prev, media, prevMedia } = i;
  const out: ResultKpi[] = [];
  const d = (c: number | null, p: number | null | undefined) => (p === undefined || p === null ? none : deltaOf(c, p, "higher_is_better"));

  const followers = (): ResultKpi | null => {
    if (i.followersGain !== null) {
      return {
        label: "Seguidores novos",
        value: `${i.followersGain >= 0 ? "+" : "−"}${num(Math.abs(i.followersGain))}`,
        delta: i.prevFollowersGain !== null
          ? { ...d(i.followersGain, i.prevFollowersGain), text: `${i.prevFollowersGain >= 0 ? "+" : "−"}${num(Math.abs(i.prevFollowersGain))} na semana anterior` }
          : { pct: null, tone: "neutral", text: prev?.seguidores != null ? `de ${num(prev.seguidores)} para ${num(cur.seguidores)}` : `${num(cur.seguidores)} no perfil` },
      };
    }
    return cur.seguidores !== null ? { label: "Seguidores no perfil", value: num(cur.seguidores), delta: { pct: null, tone: "neutral", text: "primeira semana registrada" } } : null;
  };

  if (i.kind === "vendas") {
    if (cur.receita !== null) out.push({ label: "Receita", value: money(cur.receita), delta: d(cur.receita, prev?.receita) });
    if (cur.vendas !== null) out.push({ label: "Vendas", value: num(cur.vendas), delta: d(cur.vendas, prev?.vendas) });
    if (cur.agendamentos !== null) out.push({ label: "Agendamentos", value: num(cur.agendamentos), delta: d(cur.agendamentos, prev?.agendamentos) });
    if (cur.receita !== null && cur.vendas) {
      const ticket = cur.receita / cur.vendas;
      const prevTicket = prev?.receita != null && prev?.vendas ? prev.receita / prev.vendas : null;
      out.push({ label: "Ticket médio", value: money(ticket), delta: d(ticket, prevTicket) });
    }
    const fol = followers();
    if (fol) out.push(fol);
  } else if (i.kind === "agendamentos") {
    out.push({ label: "Agendamentos", value: num(cur.agendamentos), delta: d(cur.agendamentos, prev?.agendamentos) });
    if (media.conversations !== null) out.push({ label: "Conversas", value: num(media.conversations), delta: d(media.conversations, prevMedia?.conversations) });
    const fol = followers();
    if (fol) out.push(fol);
  } else if (i.kind === "seguidores") {
    // O total do perfil já vai no rodapé do cartão principal ("de 1.214 para
    // 1.251"); um segundo cartão só com ele repetia o número.
    const fol = followers();
    if (fol) out.push(fol);
    if (media.profileVisits !== null) out.push({ label: "Visitas ao perfil", value: num(media.profileVisits), delta: d(media.profileVisits, prevMedia?.profileVisits) });
    if (media.reach !== null) out.push({ label: "Alcance", value: num(media.reach), delta: d(media.reach, prevMedia?.reach) });
  }
  if (media.spend !== null && out.length < 5) {
    out.push({ label: "Investimento", value: money(media.spend), delta: prevMedia?.spend != null ? deltaOf(media.spend, prevMedia.spend, "neutral") : none });
  }
  return out.slice(0, 5);
}

// ---- custo da conversão ----------------------------------------------------------

export type CostStep = { label: string; value: string };

/** Investimento dividido por cada etapa — "blended": todo o investimento sobre
 *  todo o resultado relatado, inclusive o que veio de outros canais. O texto do
 *  relatório diz isso; aqui só se faz a conta. */
export function costLadder(spend: number | null, conversations: number | null, t: InformedTotals): CostStep[] {
  if (spend === null || spend <= 0) return [];
  const steps: CostStep[] = [];
  if (conversations) steps.push({ label: "por conversa", value: money(spend / conversations) });
  if (t.agendamentos) steps.push({ label: "por agendamento", value: money(spend / t.agendamentos) });
  if (t.vendas) steps.push({ label: "por venda", value: money(spend / t.vendas) });
  return steps;
}

// ---- histórico -------------------------------------------------------------------

export type HistoryPoint = {
  periodTo: string;
  vendas: number | null;
  agendamentos: number | null;
  receita: number | null;
  seguidores: number | null;
};

export type HistorySeries = { key: string; label: string; values: (number | null)[] };
export type HistoryChart = { title: string; periods: string[]; series: HistorySeries[] };

const shortDay = (iso: string) => iso.slice(5).split("-").reverse().join("/");

/** Histórico da conversão principal, do mais antigo ao mais recente. Precisa de
 *  ao menos dois períodos com dado — um ponto só não é histórico. */
export function historyChart(kind: FocusKind, points: HistoryPoint[]): HistoryChart | null {
  const ordered = [...points].sort((a, b) => a.periodTo.localeCompare(b.periodTo)).slice(-8);
  const build = (title: string, series: HistorySeries[]): HistoryChart | null => {
    const present = series.filter((s) => s.values.filter((v) => v !== null).length >= 2);
    return present.length ? { title, periods: ordered.map((p) => shortDay(p.periodTo)), series: present } : null;
  };
  if (kind === "vendas") {
    return build("Vendas e agendamentos por semana", [
      { key: "agendamentos", label: "Agendamentos", values: ordered.map((p) => p.agendamentos) },
      { key: "vendas", label: "Vendas", values: ordered.map((p) => p.vendas) },
    ]);
  }
  if (kind === "agendamentos") {
    return build("Agendamentos por semana", [{ key: "agendamentos", label: "Agendamentos", values: ordered.map((p) => p.agendamentos) }]);
  }
  if (kind === "seguidores") {
    return build("Seguidores no perfil por semana", [{ key: "seguidores", label: "Seguidores", values: ordered.map((p) => p.seguidores) }]);
  }
  return null;
}

// ---- frase -------------------------------------------------------------------------

export function followersNarrative(gain: number | null, prevGain: number | null, total: number | null, visits: number | null): { headline: string; body: string } {
  if (gain === null) {
    return {
      headline: total !== null ? `${num(total)} seguidores no perfil.` : "Seguidores não informados nesta semana.",
      body: "Primeira semana registrada — o ganho semanal aparece a partir da próxima.",
    };
  }
  const verb = gain >= 0 ? `+${num(gain)} seguidores novos` : `${num(gain)} seguidores`;
  let tone = "";
  if (prevGain !== null && prevGain > 0) {
    const change = ((gain - prevGain) / prevGain) * 100;
    tone = change >= 5 ? " — ritmo acima da semana anterior" : change <= -5 ? " — ritmo abaixo da semana anterior" : " — mesmo ritmo da semana anterior";
  }
  const body = [
    prevGain !== null ? `Na semana anterior foram ${prevGain >= 0 ? "+" : ""}${num(prevGain)}.` : null,
    total !== null ? `O perfil chegou a ${num(total)}.` : null,
    visits !== null ? `A mídia levou ${num(visits)} visitas ao perfil no período.` : null,
  ].filter(Boolean).join(" ");
  return { headline: `${verb}${tone}.`, body };
}
