// Insights das telas (30/09/2026): fatos calculados aqui, redação pela IA.
//
// Cada candidato é um FATO verificável com um link que mostra exatamente aquele
// recorte: o número de "Cintia concentra 9 atrasos" é contado com o mesmo
// `operationMatchesFilters` e os mesmos filtros que o link aplica na Operação,
// então quem clica vê os 9. A IA (/api/admin/insights/ai) só escolhe os mais
// úteis e reescreve título e detalhe — nunca inventa número nem link. Sem IA,
// valem o peso e o texto daqui.

import type { ClientInsight } from "@/lib/insights/clientInsights";
import type { Piece } from "@/lib/pieces";
import { currentFlowStepOf } from "@/lib/flows/currentStep";
import type { RecurringTask } from "@/lib/supabase";
import {
  DEFAULT_OPERATION_FILTERS, operationMatchesFilters, operationSituation, operationStatusOf,
  type OperationFilter, type OperationItem, type OperationTask,
} from "../operacao/operationItems";
import { operacaoHref, type OperacaoLink } from "../operacao/operacaoLinks";

export type InsightScreen = "home" | "clientes" | "cliente" | "operacao";
export type InsightTone = "late" | "warn" | "ok" | "info";
export type InsightCandidate = {
  id: string;
  tone: InsightTone;
  title: string;
  detail: string;
  href: string;
  action: string;
  /** Prioridade sem IA: maior aparece antes. */
  weight: number;
};

export type InsightContext = {
  items: readonly OperationItem[];
  tasks: readonly OperationTask[];
  today: string;
  insights?: readonly ClientInsight[] | null;
  pieces?: readonly Piece[] | null;
  /** Tela de um cliente: tudo recortado nele. */
  client?: { slug: string; name: string } | null;
};

const SCREEN_KINDS: Record<InsightScreen, readonly string[]> = {
  home: ["late-owner", "late-client", "old-late", "stalled", "review-queue", "due-soon", "unassigned", "report-late", "pieces-late", "done-week"],
  operacao: ["late-owner", "late-client", "old-late", "stalled", "review-queue", "client-approval", "due-soon", "unassigned"],
  clientes: ["late-client", "report-late", "reach-drop", "reach-up", "followers-leader", "quiet-month", "pieces-late"],
  cliente: ["late-owner", "old-late", "stalled", "due-soon", "report-late", "reach-drop", "reach-up", "followers-leader", "pieces-late"],
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const short = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to.slice(0, 10)}T12:00:00Z`) - Date.parse(`${from.slice(0, 10)}T12:00:00Z`)) / 86_400_000);
const firstName = (name: string) => name.trim().split(/\s+/)[0];

/** A data que conta para o atraso: a próxima da rotina, a etapa atual da entrega, o fim do plano. */
export function dueOf(item: OperationItem): string | null {
  if (item.level === "rotina") return (item.task as RecurringTask).next_due_date ?? null;
  if (item.level === "entrega") return currentFlowStepOf(item.members)?.due_date ?? item.task.due_date ?? null;
  if (item.level === "plano") return item.task.end_date ?? item.task.due_date ?? null;
  return item.task.due_date ?? null;
}

/** Quantos itens o link com estes filtros mostra (padrão de status incluso). */
export function countFor(items: readonly OperationItem[], link: Omit<OperacaoLink, "area" | "agrupar" | "visao">, today: string): number {
  const filters: OperationFilter[] = [...(link.status?.length ? [] : DEFAULT_OPERATION_FILTERS)];
  for (const status of link.status ?? []) filters.push({ attr: "status", value: status, label: status });
  if (link.situacao) filters.push({ attr: "situacao", value: link.situacao, label: link.situacao });
  if (link.cliente) filters.push({ attr: "cliente", value: link.cliente, label: link.cliente });
  if (link.responsavel) filters.push({ attr: "responsavel", value: link.responsavel, label: link.responsavel });
  return items.filter((item) => operationMatchesFilters(item, filters, today)).length;
}

export function buildInsightCandidates(screen: InsightScreen, context: InsightContext): InsightCandidate[] {
  const { today, client } = context;
  const items = client ? context.items.filter((item) => item.clientSlug === client.slug) : context.items;
  const scope = client ? { cliente: client.name } : {};
  const open = items.filter((item) => operationStatusOf(item) !== "aprovado" && !item.task.completed_at);
  const late = open.filter((item) => operationSituation(item, today) === "atrasada");
  const out: InsightCandidate[] = [];

  // Quem concentra os atrasos. O filtro de responsável acha também os pais
  // com itens abertos da pessoa, então a contagem vem do mesmo filtro.
  const owners = new Map<string, number>();
  for (const item of late) for (const name of (item.task.assignee ?? "").split(",").map((value) => value.trim()).filter(Boolean)) owners.set(firstName(name), 0);
  for (const name of owners.keys()) owners.set(name, countFor(items, { ...scope, situacao: "atrasada", responsavel: name }, today));
  const topOwner = [...owners.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topOwner && topOwner[1] >= 3 && late.length >= 4) {
    out.push({
      id: "late-owner", tone: "late", weight: 80 + Math.round((topOwner[1] / late.length) * 20),
      title: `${topOwner[0]} concentra ${topOwner[1]} dos ${late.length} atrasos`,
      detail: "É o maior gargalo agora: repriorizar ou redistribuir aqui destrava mais trabalho do que qualquer outra ação.",
      href: operacaoHref({ ...scope, responsavel: topOwner[0], situacao: "atrasada", agrupar: "cliente" }), action: `Atrasos de ${topOwner[0]}`,
    });
  }

  // O cliente com mais atraso (só fora da tela de um cliente).
  if (!client) {
    const byClient = new Map<string, number>();
    for (const item of late) byClient.set(item.clientName, (byClient.get(item.clientName) ?? 0) + 1);
    const topClient = [...byClient.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topClient && topClient[1] >= 3) {
      out.push({
        id: "late-client", tone: "late", weight: 70 + topClient[1],
        title: `${topClient[0]} tem ${plural(topClient[1], "atraso", "atrasos")}, o maior da agência`,
        detail: `${Math.round((topClient[1] / Math.max(late.length, 1)) * 100)}% de tudo o que está atrasado é deste cliente.`,
        href: operacaoHref({ cliente: topClient[0], situacao: "atrasada", agrupar: "prazo" }), action: `Operação de ${topClient[0]}`,
      });
    }
  }

  // Atraso antigo: provavelmente abandonado, não esquecido por um dia.
  const old = late.filter((item) => { const due = dueOf(item); return due !== null && daysBetween(due, today) > 14; });
  if (old.length >= 3) {
    out.push({
      id: "old-late", tone: "warn", weight: 60 + old.length,
      title: `${plural(old.length, "item atrasado", "itens atrasados")} há mais de duas semanas`,
      detail: "Atraso tão antigo costuma ser trabalho que mudou de rumo. Encerrar ou remarcar limpa a fila e deixa o que é urgente à vista.",
      href: operacaoHref({ ...scope, situacao: "atrasada", agrupar: "prazo" }), action: "Revisar por prazo",
    });
  }

  const stalled = countFor(items, { ...scope, situacao: "parada" }, today);
  if (stalled) {
    out.push({
      id: "stalled", tone: "warn", weight: 55 + stalled,
      title: `${plural(stalled, "item parado", "itens parados")} esperando algo para andar`,
      detail: "Parado não aparece como atraso até vencer. Vale ver o que falta para cada um sair do lugar.",
      href: operacaoHref({ ...scope, situacao: "parada" }), action: "Ver parados",
    });
  }

  const inReview = countFor(items, { ...scope, status: ["revisao"] }, today);
  if (inReview >= 4) {
    out.push({
      id: "review-queue", tone: "info", weight: 50 + inReview,
      title: `${plural(inReview, "card espera", "cards esperam")} revisão interna`,
      detail: "Revisão acumulada segura a entrega ao cliente. Uma rodada de revisão hoje libera tudo para aprovação.",
      href: operacaoHref({ ...scope, status: ["revisao"], agrupar: "cliente" }), action: "Abrir fila de revisão",
    });
  }

  const withClient = countFor(items, { ...scope, status: ["aprovacao"] }, today);
  if (withClient >= 3) {
    out.push({
      id: "client-approval", tone: "info", weight: 40 + withClient,
      title: `${plural(withClient, "card está", "cards estão")} com o cliente para aprovar`,
      detail: "Um lembrete ao cliente costuma destravar a fila de aprovação de uma vez.",
      href: operacaoHref({ ...scope, status: ["aprovacao"], agrupar: "cliente" }), action: "Ver aprovações",
    });
  }

  const soon = open.filter((item) => { const due = dueOf(item); return due !== null && due.slice(0, 10) >= today && daysBetween(today, due) <= 2; });
  if (soon.length >= 2) {
    out.push({
      id: "due-soon", tone: "info", weight: 45 + soon.length,
      title: `${plural(soon.length, "item vence", "itens vencem")} até depois de amanhã`,
      detail: "Olhar agora evita que virem os atrasos da semana que vem.",
      href: operacaoHref({ ...scope, agrupar: "prazo" }), action: "Ver por prazo",
    });
  }

  const unassigned = countFor(items, { ...scope, responsavel: "Sem responsável" }, today);
  if (unassigned >= 3) {
    out.push({
      id: "unassigned", tone: "warn", weight: 45 + unassigned,
      title: `${plural(unassigned, "item aberto está", "itens abertos estão")} sem responsável`,
      detail: "Sem dono, ninguém recebe aviso de prazo. Atribuir resolve na hora.",
      href: operacaoHref({ ...scope, responsavel: "Sem responsável" }), action: "Atribuir",
    });
  }

  // Dos relatórios e do Feedback.
  const reports = (context.insights ?? []).filter((row) => !client || row.slug === client.slug);
  const lateReports = reports.filter((row) => row.nextReport && row.nextReport < today).sort((a, b) => a.nextReport!.localeCompare(b.nextReport!));
  if (lateReports.length) {
    const first = lateReports[0];
    out.push({
      id: "report-late", tone: "late", weight: 65 + lateReports.length,
      title: lateReports.length === 1 ? `O relatório de ${first.name} está atrasado desde ${short(first.nextReport!)}` : `${lateReports.length} relatórios semanais atrasados`,
      detail: lateReports.length === 1
        ? "A automação espera a data do molde de anúncios. Remarcar o molde volta a gerar o relatório toda semana."
        : `${lateReports.map((row) => row.name).slice(0, 3).join(", ")}${lateReports.length > 3 ? " e outros" : ""}. Remarcar os moldes volta a gerar os relatórios.`,
      href: `/admin/${first.slug}/visao`, action: lateReports.length === 1 ? `Ver ${first.name}` : `Começar por ${first.name}`,
    });
  }

  const reachChanges = reports
    .map((row) => { const [prev, last] = [row.media.at(-2), row.media.at(-1)]; return { row, change: prev?.reach && last?.reach !== null && last?.reach !== undefined ? (last.reach - prev.reach) / prev.reach : null }; })
    .filter((entry): entry is { row: ClientInsight; change: number } => entry.change !== null);
  const drop = reachChanges.filter((entry) => entry.change <= -0.3).sort((a, b) => a.change - b.change)[0];
  if (drop) {
    out.push({
      id: "reach-drop", tone: "warn", weight: 50 + Math.round(-drop.change * 20),
      title: `Alcance de ${drop.row.name} caiu ${Math.round(-drop.change * 100)}% na semana`,
      detail: "Queda forte de uma semana para outra costuma ser campanha pausada, verba menor ou criativo cansado. A Performance mostra qual.",
      href: `/admin/performance?cliente=${encodeURIComponent(drop.row.slug)}`, action: "Abrir Performance",
    });
  }
  const rise = reachChanges.filter((entry) => entry.change >= 0.3).sort((a, b) => b.change - a.change)[0];
  if (rise) {
    out.push({
      id: "reach-up", tone: "ok", weight: 35 + Math.round(rise.change * 10),
      title: `Alcance de ${rise.row.name} subiu ${Math.round(rise.change * 100)}% na semana`,
      detail: "Vale entender o que funcionou e repetir nos próximos criativos.",
      href: `/admin/performance?cliente=${encodeURIComponent(rise.row.slug)}`, action: "Ver o que funcionou",
    });
  }

  const month = today.slice(0, 7);
  const monthGains = reports
    .map((row) => ({ row, gain: row.followers.filter((week) => week.periodTo.slice(0, 7) === month && week.gain !== null).reduce((sum, week) => sum + (week.gain ?? 0), 0) }))
    .filter((entry) => entry.gain > 0)
    .sort((a, b) => b.gain - a.gain);
  if (monthGains[0]) {
    out.push({
      id: "followers-leader", tone: "ok", weight: 30,
      title: client ? `+${monthGains[0].gain} seguidores neste mês` : `${monthGains[0].row.name} lidera o mês com +${monthGains[0].gain} seguidores`,
      detail: "Informados no Feedback semanal. É o sinal mais direto de que o conteúdo está trazendo gente nova.",
      href: `/admin/${monthGains[0].row.slug}/visao`, action: "Ver cliente",
    });
  }

  const pieces = (context.pieces ?? []).filter((piece) => !client || piece.clientSlug === client.slug);
  const latePieces = pieces.filter((piece) => piece.state === "atrasada");
  if (latePieces.length) {
    out.push({
      id: "pieces-late", tone: "late", weight: 55 + latePieces.length,
      title: `${plural(latePieces.length, "peça atrasada", "peças atrasadas")} para publicar`,
      detail: `A mais antiga é "${latePieces.at(-1)!.title}"${latePieces.at(-1)!.clientName && !client ? `, de ${latePieces.at(-1)!.clientName}` : ""}.`,
      href: "/admin/operacao?area=planos-entregas&visao=feed&estado=atrasada", action: "Abrir o Feed",
    });
  }

  if (!client && pieces.length) {
    const active = [...new Set(pieces.map((piece) => piece.clientName))];
    const delivered = new Set(pieces.filter((piece) => piece.state === "concluida" && piece.date?.slice(0, 7) === month).map((piece) => piece.clientName));
    const quiet = active.filter((name) => !delivered.has(name));
    if (quiet.length && today.slice(8, 10) >= "10") {
      out.push({
        id: "quiet-month", tone: "warn", weight: 40 + quiet.length,
        title: `${plural(quiet.length, "cliente sem", "clientes sem")} peça concluída neste mês`,
        detail: `${quiet.slice(0, 3).join(", ")}${quiet.length > 3 ? " e outros" : ""}. Cliente sem entrega visível no mês é o que mais pesa na renovação.`,
        href: "/admin/operacao?area=planos-entregas&visao=feed", action: "Abrir o Feed",
      });
    }
  }

  const doneWeek = context.tasks.filter((task) => task.completed_at && daysBetween(task.completed_at, today) <= 7 && (!client || task.clientSlug === client.slug)).length;
  if (doneWeek) {
    out.push({
      id: "done-week", tone: "ok", weight: 15,
      title: `${plural(doneWeek, "card concluído", "cards concluídos")} nos últimos 7 dias`,
      detail: "O ritmo da semana, somando tarefas, etapas e rotinas.",
      href: operacaoHref({ ...scope, status: ["aprovado"], agrupar: "prazo" }), action: "Ver concluídos",
    });
  }

  const allowed = new Set(SCREEN_KINDS[screen]);
  return out.filter((candidate) => allowed.has(candidate.id)).sort((a, b) => b.weight - a.weight);
}
