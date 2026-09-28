// Comentários REAIS da equipe, copiados do banco, com o que cada um quer dizer.
// É a régua do intérprete (lib/ai/interpretComment.ts): os testes unitários
// conferem as regras e os guarda-corpos contra ela, e o eval manual
// (interpretComment.manual.test.ts) mede o modelo de verdade contra ela.
//
// Cada `expect` lista só o que tem de sair; campo ausente não é conferido.
// Ao achar um comentário novo interpretado errado, acrescente-o aqui antes de
// mexer no prompt ou nas regras.

import type { InterpretContext, TeamCommentIntent } from "./interpretComment";

export type CorpusCase = {
  id: string;
  text: string;
  ctx: InterpretContext;
  expect: Partial<Pick<TeamCommentIntent, "seguidoresNovos" | "seguidoresTotal" | "hide" | "approval" | "useful">> & {
    metrics?: Record<string, number>;
    reachTotal?: number | null;
    reachByObjective?: TeamCommentIntent["reach"]["byObjective"];
    /** Trecho que a leitura tem de conter (a leitura inteira é longa). */
    narrativeContains?: string | null;
    visual?: boolean;
  };
};

const TAGS = ["vendas", "agendamentos", "seguidores", "receita"];
const feedback: InterpretContext = { step: "feedback", tags: TAGS };
const conversao: InterpretContext = { step: "relatorio_conversao", tags: TAGS };

export const CORPUS: CorpusCase[] = [
  // ---- 28/09/2026 (Luiza) ----------------------------------------------------
  {
    id: "baita-feedback-seguidores-e-leitura",
    text: "Incluir crescimento de 114 novo seguidores nos dados do funil e campanhas\n\n\nLeitura da semana: Semana com foco em apresentção da Baita para publico novo com foco em região de NH e POA.",
    ctx: feedback,
    expect: { seguidoresNovos: 114, narrativeContains: "Semana com foco em apresentção da Baita", visual: false, useful: true },
  },
  {
    id: "cris-feedback-seguidores-novos",
    text: "seguidores novos:39",
    ctx: feedback,
    expect: { seguidoresNovos: 39, visual: false, useful: true },
  },
  {
    id: "cris-feedback-seguidores-total",
    text: "seguidores: 30,9 mil",
    ctx: feedback,
    expect: { seguidoresTotal: 30900, useful: true },
  },
  {
    id: "cris-feedback-instrucoes-e-leitura",
    text: "No próximo relatorio não incluir nenhum dado percentual comparativo que informe redução nos resultados e aumento nos custos. Não incluir numero de compras, nem custo por compra. Leitura da semana: As campanhas de trafego para site e trafego para o perfil estão sendo direcionadas para as capitais do RS, SC e PR, no intuito de alcançar novas pessoas.",
    ctx: feedback,
    expect: { hide: ["percentual_comparativo", "compras"], narrativeContains: "direcionadas para as capitais do RS", visual: false, useful: true },
  },
  {
    id: "cris-feedback-sobreposicao",
    text: "Está sobrepondo entre criativos e o título  da campanha seguinte",
    ctx: feedback,
    expect: { visual: true, useful: true },
  },
  {
    id: "cris-molde-alcance-compras-leitura",
    text: "alcance corrigir para 12.452. Substituir as frases de leitura da semana por essas: Não incluir numero de compras, nem custo por compra. Leitura da semana: As campanhas de trafego para site e trafego para o perfil estão sendo direcionadas para as capitais do RS, SC e PR, no intuito de alcançar novas pessoas.",
    ctx: conversao,
    expect: { reachTotal: 12452, hide: ["compras"], narrativeContains: "direcionadas para as capitais do RS", visual: false },
  },
  {
    id: "karpinski-conversao-alcance-por-campanha",
    text: "Corrija o numero de alcance: total 6311. Sendo 8425 da campanha de trafego pro perfil e 3785 da campanha de mensagem pro whastapp",
    ctx: conversao,
    expect: { reachTotal: 6311, reachByObjective: { trafego_perfil: 8425, mensagens: 3785 }, visual: false },
  },
  {
    id: "karpinski-feedback-leitura-sem-rotulo",
    text: "Nesta semana direcionamos a atenção para público engajado e público com poder aquisitivo direcionando para Iphone. Os criativos de carro novo e sobre PPF performaram bem.",
    ctx: feedback,
    expect: { narrativeContains: "direcionamos a atenção para público engajado", useful: true },
  },
  {
    id: "karpinski-feedback-seguidores-total-e-ganho",
    text: "seguidores 9078. sendo 65 frutos das campanhas de trafego para o perfil nos ultimos 7 dias",
    ctx: feedback,
    expect: { seguidoresTotal: 9078, seguidoresNovos: 65, useful: true },
  },
  {
    id: "baita-anuncios-alcance",
    text: "alcance correto 9307",
    ctx: conversao,
    expect: { reachTotal: 9307 },
  },
  {
    id: "baita-aprovado",
    text: "aprovado",
    ctx: feedback,
    expect: { approval: true, useful: true },
  },
  // ---- 15–21/09/2026 (feedbackReal.test.ts) -----------------------------------
  {
    id: "cris-seguidores-ganho-e-base",
    text: "21 novos seguidores. O perfil já estava com mias de 30000 seguidores",
    ctx: feedback,
    expect: { seguidoresNovos: 21, useful: true },
  },
  // ---- conversa solta: não é dado nem pedido --------------------------------
  {
    id: "conversa-solta",
    text: "vou confirmar com o cliente e já volto aqui",
    ctx: feedback,
    expect: { useful: false, visual: false },
  },
];

/** Confere só os campos que o caso declara. */
export function mismatches(c: CorpusCase, i: TeamCommentIntent): string[] {
  const e = c.expect;
  const out: string[] = [];
  const check = (name: string, ok: boolean) => { if (!ok) out.push(name); };
  if ("seguidoresNovos" in e) check("seguidoresNovos", i.seguidoresNovos === e.seguidoresNovos);
  if ("seguidoresTotal" in e) check("seguidoresTotal", i.seguidoresTotal === e.seguidoresTotal);
  if ("reachTotal" in e) check("reachTotal", i.reach.total === e.reachTotal);
  if (e.reachByObjective) check("reachByObjective", JSON.stringify(i.reach.byObjective) === JSON.stringify(e.reachByObjective));
  if (e.metrics) check("metrics", JSON.stringify(i.metrics) === JSON.stringify(e.metrics));
  if (e.hide) check("hide", [...i.hide].sort().join() === [...e.hide].sort().join());
  if ("narrativeContains" in e) check("narrative", e.narrativeContains === null ? i.narrative === null : Boolean(i.narrative?.includes(e.narrativeContains!)));
  if ("visual" in e) check("visual", Boolean(i.visual) === e.visual);
  if ("approval" in e) check("approval", i.approval === e.approval);
  if ("useful" in e) check("useful", i.useful === e.useful);
  return out;
}

