"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AUTOMATION_DEFINITIONS, AUTOMATION_KEYS } from "@/lib/automationCatalog";
import { parseCommand, type Cadence, type ParsedCommand, type RecipeKey } from "@/lib/northai/commandParser";
import { parseScripts } from "@/lib/northai/scriptParser";
import { NORTH_FORMATS, formatByKey, type NorthFormatKey } from "@/lib/northai/formats";
import {
  automationBlueprint,
  defaultPublishDate,
  flowBlueprint,
  planBlueprint,
  routineBlueprint,
  shootDayBlueprint,
  shortDate,
  type ShootDayDraftPiece,
} from "@/lib/northai/recipes";
import type { BlueprintCreated, BuiltBlueprint, PreviewLine } from "@/lib/northai/blueprint";
import { todayInTimezone } from "../recurringState";

// Estúdio do NorthAi — harness DETERMINÍSTICO (sem LLM, decisão de 15/09).
//
// Três colunas, como a referência "Estúdio IA": sessões por cliente à esquerda,
// a conversa no meio (cards de ação → receita guiada → prévia → criado), o
// contexto do cliente à direita (quão amarrado está e o que falta).
//
// Nada é criado sem a prévia. Texto digitado só PRÉ-PREENCHE uma receita
// (lib/northai/commandParser.ts); roteiros colados viram peças da diária
// (scriptParser.ts); um link do Google é copiado para o GED antes de ser lido.
// A execução é um Blueprint (lib/northai/blueprint.ts) — o mesmo contrato que o
// harness com IA vai usar quando rodar na VPS.

type ClientLite = { slug: string; name: string };
type TypeLite = { key: string; label: string; behavior: string; shootReady: boolean };
type GapView = {
  key: string;
  severity: "alta" | "media" | "baixa";
  title: string;
  detail: string;
  recipe: RecipeKey | null;
  prefill?: Record<string, unknown>;
  tasks: { id: string; title: string }[];
};
type ContextData = {
  client: ClientLite;
  today: string;
  insight: {
    gaps: GapView[];
    readiness: { percent: number; checks: { key: string; label: string; ok: boolean }[] };
    numbers: { atrasadas: number; paradas: number; semana: number; emAndamento: number };
  };
  ged: { provider: "drive" | "storage"; folders: { key: string; path: string }[] };
  targets: { id: string; title: string }[];
  plans: { id: string; title: string }[];
};
type Entry = {
  id: string;
  at: string;
  clientSlug: string | null;
  title: string;
  preview: PreviewLine[];
  created: BlueprintCreated[];
  error: string | null;
  note: string | null;
  running: boolean;
};

type ShootState = { shootDate: string; typeKey: string; assignee: string; withPlan: boolean; docUrl: string | null; scriptsText: string; pieces: ShootDayDraftPiece[] };
type PlanState = { title: string; startDate: string; assignee: string; counts: Partial<Record<NorthFormatKey, number>>; extra: string };
type RoutineState = { title: string; description: string; cadence: Cadence | ""; startDate: string; weekdays: number[]; assignee: string };
type FlowState = { typeKey: string; title: string; count: number; format: NorthFormatKey; dueDate: string; assignee: string; planId: string };
type AutomationState = { automationKey: string; mode: "existing" | "new"; targetTaskId: string; newTitle: string; cadence: Cadence; startDate: string; assignee: string };

const STORAGE_KEY = "northai.studio.v1";
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const ACTIONS: { key: RecipeKey; title: string; blurb: string }[] = [
  { key: "diaria", title: "Diária de gravação", blurb: "Roteiros de uma gravação viram várias publicações" },
  { key: "plano", title: "Plano de ação", blurb: "Volume de conteúdo e atividades com prazo" },
  { key: "rotina", title: "Rotina", blurb: "Assessoria, reunião e checks recorrentes" },
  { key: "fluxo", title: "Fluxo", blurb: "Entregas em cascata, com formato" },
  { key: "automacao", title: "Automação", blurb: "Relatório semanal e coleta de métricas" },
  { key: "analise", title: "Analisar operação", blurb: "Atrasos, paradas e o que falta amarrar" },
];

const RECIPE_TITLE: Record<RecipeKey, string> = {
  diaria: "Diária de gravação",
  plano: "Plano de ação",
  rotina: "Rotina",
  fluxo: "Fluxo",
  automacao: "Automação",
  analise: "Analisar operação",
};

function pieceTitle(format: NorthFormatKey, index: number) {
  return `${formatByKey(format).label} ${index + 1}`;
}

function piecesFromCounts(counts: Partial<Record<NorthFormatKey, number>>): ShootDayDraftPiece[] {
  return NORTH_FORMATS.flatMap((format) =>
    Array.from({ length: Math.min(20, counts[format.key] ?? 0) }, (_, index) => ({ title: pieceTitle(format.key, index), format: format.key, publishDate: null, body: "" })),
  );
}

function readStorage(): { clientSlug: string | null; entries: Entry[] } {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { clientSlug: null, entries: [] };
    const parsed = JSON.parse(raw) as { clientSlug?: unknown; entries?: unknown };
    return {
      clientSlug: typeof parsed.clientSlug === "string" ? parsed.clientSlug : null,
      entries: Array.isArray(parsed.entries) ? (parsed.entries as Entry[]).filter((entry) => entry && typeof entry.id === "string").map((entry) => ({ ...entry, running: false })) : [],
    };
  } catch {
    return { clientSlug: null, entries: [] };
  }
}

function QtyField({ label, value, onChange }: { label: string; value: number; onChange: (next: number) => void }) {
  const set = (next: number) => onChange(Math.max(0, Math.min(30, Math.trunc(next) || 0)));
  return (
    <div className={`pac-row${value ? " on" : ""}`}>
      <button type="button" className="pac-row-main" onClick={() => set(value + 1)}>
        <span className="pac-row-label">{label}</span>
      </button>
      <div className="pac-qty">
        <button type="button" aria-label={`Menos ${label}`} disabled={!value} onClick={() => set(value - 1)}>−</button>
        <input type="number" min={0} max={30} aria-label={`Quantidade de ${label}`} value={value} onChange={(event) => set(Number(event.target.value))} />
        <button type="button" aria-label={`Mais ${label}`} onClick={() => set(value + 1)}>+</button>
      </div>
    </div>
  );
}

export default function NorthAiStudio({ clients, assignees, types }: { clients: ClientLite[]; assignees: string[]; types: TypeLite[] }) {
  const today = todayInTimezone("America/Sao_Paulo");
  const shootTypes = types.filter((type) => type.shootReady);
  const deliveryTypes = types.filter((type) => type.behavior === "entrega");

  const [clientSlug, setClientSlug] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [context, setContext] = useState<ContextData | null>(null);
  const [contextError, setContextError] = useState("");
  const [recipe, setRecipe] = useState<RecipeKey | null>(null);
  const [composer, setComposer] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const [shoot, setShoot] = useState<ShootState>({ shootDate: "", typeKey: shootTypes[0]?.key ?? "", assignee: "", withPlan: true, docUrl: null, scriptsText: "", pieces: [] });
  const [plan, setPlan] = useState<PlanState>({ title: "", startDate: today, assignee: "", counts: {}, extra: "" });
  const [routine, setRoutine] = useState<RoutineState>({ title: "", description: "", cadence: "semanal", startDate: today, weekdays: [], assignee: "" });
  const [flow, setFlow] = useState<FlowState>({ typeKey: deliveryTypes[0]?.key ?? "", title: "", count: 1, format: "reels", dueDate: "", assignee: "", planId: "" });
  const [automation, setAutomation] = useState<AutomationState>({ automationKey: "relatorio_trafego_semanal", mode: "new", targetTaskId: "", newTitle: "Relatório semanal de anúncios", cadence: "semanal", startDate: today, assignee: "" });

  const client = clients.find((entry) => entry.slug === clientSlug) ?? null;

  // localStorage só depois de montar (regra de hidratação do CLAUDE.md).
  useEffect(() => {
    const stored = readStorage();
    if (stored.clientSlug && clients.some((entry) => entry.slug === stored.clientSlug)) setClientSlug(stored.clientSlug);
    setEntries(stored.entries);
    setHydrated(true);
  }, [clients]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ clientSlug, entries: entries.slice(-40) }));
    } catch {
      // armazenamento indisponível: o Estúdio funciona igual, só não lembra a sessão
    }
  }, [clientSlug, entries, hydrated]);

  const loadContext = useCallback(async (slug: string | null) => {
    setContextError("");
    if (!slug) { setContext(null); return; }
    try {
      const res = await fetch(`/api/admin/northai/context?slug=${encodeURIComponent(slug)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Não foi possível carregar o contexto.");
      setContext(data as ContextData);
    } catch (error) {
      setContext(null);
      setContextError(error instanceof Error ? error.message : "Não foi possível carregar o contexto.");
    }
  }, []);

  useEffect(() => { void loadContext(clientSlug); }, [clientSlug, loadContext]);

  const built = useMemo((): { value: BuiltBlueprint | null; problem: string | null } => {
    if (!recipe || recipe === "analise") return { value: null, problem: null };
    try {
      if ((recipe === "diaria" || recipe === "automacao") && !client) return { value: null, problem: "Escolha o cliente." };
      if (recipe === "diaria") {
        if (!shoot.typeKey) return { value: null, problem: "Nenhum tipo Entrega tem as etapas de roteiro e captação." };
        if (!shoot.shootDate) return { value: null, problem: "Informe a data da gravação." };
        if (!shoot.pieces.length) return { value: null, problem: "Adicione pelo menos uma publicação." };
        return {
          value: shootDayBlueprint({
            clientSlug: client!.slug,
            clientName: client!.name,
            shootDate: shoot.shootDate,
            typeKey: shoot.typeKey,
            assignee: shoot.assignee || null,
            docUrl: shoot.docUrl,
            withPlan: shoot.withPlan,
            pieces: shoot.pieces.map((piece) => ({ ...piece, title: piece.title.trim() || "Publicação" })),
          }),
          problem: null,
        };
      }
      if (recipe === "plano") {
        if (!plan.title.trim()) return { value: null, problem: "Dê um nome ao plano." };
        return {
          value: planBlueprint({ clientSlug: client?.slug ?? null, title: plan.title.trim(), startDate: plan.startDate || today, assignee: plan.assignee || null, counts: plan.counts, extraTasks: plan.extra.split("\n") }),
          problem: null,
        };
      }
      if (recipe === "rotina") {
        if (!routine.title.trim()) return { value: null, problem: "Dê um nome à rotina." };
        return {
          value: routineBlueprint({ clientSlug: client?.slug ?? null, title: routine.title.trim(), description: routine.description.trim() || null, cadence: routine.cadence || null, startDate: routine.startDate || today, weekdays: routine.weekdays, assignee: routine.assignee || null }),
          problem: null,
        };
      }
      if (recipe === "fluxo") {
        const type = deliveryTypes.find((entry) => entry.key === flow.typeKey);
        if (!type) return { value: null, problem: "Escolha o tipo de entrega." };
        if (!flow.title.trim()) return { value: null, problem: "Dê um título às entregas." };
        return {
          value: flowBlueprint({ clientSlug: client?.slug ?? null, typeKey: type.key, typeLabel: type.label, title: flow.title.trim(), count: flow.count, format: flow.format, dueDate: flow.dueDate || null, assignee: flow.assignee || null, planId: flow.planId || null }),
          problem: null,
        };
      }
      const target = context?.targets.find((entry) => entry.id === automation.targetTaskId) ?? null;
      return {
        value: automationBlueprint({
          clientSlug: client!.slug,
          automationKey: automation.automationKey,
          targetTaskId: automation.mode === "existing" ? automation.targetTaskId || null : null,
          targetTitle: target?.title ?? null,
          newTarget: automation.mode === "new" ? { title: automation.newTitle.trim() || "Rotina da automação", cadence: automation.cadence, startDate: automation.startDate || today, assignee: automation.assignee || null } : null,
          performanceTemplateId: null,
        }),
        problem: null,
      };
    } catch (error) {
      return { value: null, problem: error instanceof Error ? error.message : "Receita incompleta." };
    }
  }, [recipe, client, shoot, plan, routine, flow, automation, context, deliveryTypes, today]);

  function pushEntry(entry: Omit<Entry, "id" | "at" | "clientSlug">): string {
    const id = crypto.randomUUID();
    setEntries((current) => [...current, { id, at: new Date().toISOString(), clientSlug, ...entry }]);
    return id;
  }
  function patchEntry(id: string, patch: Partial<Entry>) {
    setEntries((current) => current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
  }

  function openRecipe(key: RecipeKey, prefill?: Record<string, unknown>) {
    setNotice("");
    if (key === "analise") {
      setRecipe(null);
      if (!context) { setNotice(client ? "Carregando o contexto do cliente…" : "Escolha o cliente para analisar a operação."); return; }
      const lines: PreviewLine[] = context.insight.gaps.length
        ? context.insight.gaps.map((gap) => ({ icon: gap.severity === "alta" ? "!" : "○", text: gap.title, detail: gap.detail }))
        : [{ icon: "✓", text: "Nada pendente — o cliente está amarrado." }];
      pushEntry({ title: `Análise da operação — ${context.client.name}`, preview: lines, created: [], error: null, note: `Cadastro conectado ${context.insight.readiness.percent}%`, running: false });
      return;
    }
    if (key === "rotina" && prefill) {
      setRoutine((current) => ({
        ...current,
        title: typeof prefill.title === "string" ? prefill.title : current.title,
        description: typeof prefill.description === "string" ? prefill.description : current.description,
        cadence: prefill.cadence === "semanal" || prefill.cadence === "quinzenal" || prefill.cadence === "mensal" ? prefill.cadence : "",
      }));
    }
    if (key === "automacao" && typeof prefill?.automationKey === "string") {
      setAutomation((current) => ({ ...current, automationKey: prefill.automationKey as string }));
    }
    if (key === "plano" && !plan.title && client) setPlan((current) => ({ ...current, title: `Plano de conteúdo — ${client.name}` }));
    setRecipe(key);
  }

  function openFromCommand(parsed: ParsedCommand, text: string) {
    const date = parsed.dates[0] ?? "";
    const intent = parsed.intent;
    if (!intent) {
      setNotice("Não reconheci o pedido. Escolha um card abaixo ou escreva algo como “3 reels e 1 carrossel, gravação 22/09”.");
      return;
    }
    if (intent === "diaria") {
      const pieces = piecesFromCounts(parsed.counts);
      setShoot((current) => ({ ...current, shootDate: date || current.shootDate, pieces: pieces.length ? pieces : current.pieces }));
    } else if (intent === "plano") {
      setPlan((current) => ({ ...current, counts: Object.keys(parsed.counts).length ? parsed.counts : current.counts, startDate: date || current.startDate }));
    } else if (intent === "rotina") {
      setRoutine((current) => ({ ...current, title: current.title || text.slice(0, 80), cadence: parsed.cadence ?? current.cadence, weekdays: parsed.weekdays.length ? parsed.weekdays : current.weekdays, startDate: date || current.startDate }));
    } else if (intent === "fluxo") {
      const first = (Object.keys(parsed.counts)[0] as NorthFormatKey | undefined) ?? flow.format;
      const count = Object.values(parsed.counts).reduce((sum, value) => sum + (value ?? 0), 0);
      setFlow((current) => ({ ...current, format: first, count: count || current.count, dueDate: date || current.dueDate, title: current.title || text.slice(0, 80) }));
    }
    openRecipe(intent);
  }

  async function importLink(url: string, slug: string) {
    const entryId = pushEntry({ title: "Copiando o arquivo para o GED…", preview: [{ icon: "↧", text: url }], created: [], error: null, note: null, running: true });
    try {
      const res = await fetch("/api/admin/northai/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, slug }) });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Não foi possível copiar o arquivo.");
      const scripts = (data.scripts ?? []) as ReturnType<typeof parseScripts>;
      patchEntry(entryId, {
        running: false,
        title: `Copiado para o GED: ${data.document?.fileName ?? "arquivo"}`,
        note: `${data.folderPath}${data.driveMirror && !data.driveMirror.ok ? ` · Drive: ${data.driveMirror.reason}` : ""}`,
        preview: scripts.length ? scripts.map((script) => ({ icon: "✎", text: script.title, detail: formatByKey(script.format).label })) : [],
      });
      if (scripts.length) {
        setShoot((current) => ({
          ...current,
          docUrl: url,
          scriptsText: data.text ?? "",
          pieces: scripts.map((script) => ({ title: script.title, format: script.format, publishDate: null, body: script.body })),
        }));
        setRecipe("diaria");
      }
      void loadContext(slug);
    } catch (error) {
      patchEntry(entryId, { running: false, title: "Não copiei o arquivo", error: error instanceof Error ? error.message : "Falha ao importar." });
    }
  }

  async function send() {
    const text = composer.trim();
    if (!text) return;
    setNotice("");
    const parsed = parseCommand(text, { clients, today });
    const slug = parsed.clientSlug ?? clientSlug;
    if (parsed.clientSlug) setClientSlug(parsed.clientSlug);
    setComposer("");
    if (parsed.links.length) {
      if (!slug) { setNotice("Escolha o cliente para copiar o arquivo para o GED dele."); setComposer(text); return; }
      await importLink(parsed.links[0], slug);
      return;
    }
    const lines = text.split("\n").filter((line) => line.trim()).length;
    if ((lines >= 4 || text.length > 280) && (!parsed.intent || parsed.intent === "diaria")) {
      const pieces = parseScripts(text).map((script) => ({ title: script.title, format: script.format, publishDate: null, body: script.body }));
      setShoot((current) => ({ ...current, scriptsText: text, pieces, shootDate: parsed.dates[0] ?? current.shootDate }));
      setRecipe("diaria");
      return;
    }
    openFromCommand(parsed, text);
  }

  async function run() {
    if (!built.value || busy) return;
    setBusy(true);
    const { blueprint, preview } = built.value;
    const entryId = pushEntry({ title: blueprint.title, preview, created: [], error: null, note: client ? client.name : "Sem cliente", running: true });
    try {
      const res = await fetch("/api/admin/northai/execute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ blueprint }) });
      const data = await res.json().catch(() => null);
      const created = Array.isArray(data?.created) ? (data.created as BlueprintCreated[]) : [];
      const error = !res.ok ? (data?.error ?? "Não foi possível criar.") : null;
      patchEntry(entryId, { running: false, created, error });
      if (!error) setRecipe(null);
    } catch {
      patchEntry(entryId, { running: false, error: "Falha de rede ao criar." });
    } finally {
      setBusy(false);
      void loadContext(clientSlug);
    }
  }

  const clientEntries = entries.filter((entry) => entry.clientSlug === clientSlug);
  const sessions = useMemo(() => {
    const bySlug = new Map<string, Entry[]>();
    for (const entry of entries) {
      if (!entry.clientSlug) continue;
      bySlug.set(entry.clientSlug, [...(bySlug.get(entry.clientSlug) ?? []), entry]);
    }
    return [...bySlug.entries()]
      .map(([slug, list]) => ({ slug, name: clients.find((entry) => entry.slug === slug)?.name ?? slug, count: list.length, last: list[list.length - 1] }))
      .sort((a, b) => b.last.at.localeCompare(a.last.at));
  }, [entries, clients]);

  const assigneeSelect = (value: string, onChange: (next: string) => void) => (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">Sem responsável</option>
      {assignees.map((name) => <option key={name} value={name}>{name}</option>)}
    </select>
  );

  return (
    <div className="nai-grid">
      <aside className="nai-history" aria-label="Sessões recentes">
        <p className="nai-side-title">Sessões por cliente</p>
        {sessions.length ? (
          <ul>
            {sessions.map((session) => (
              <li key={session.slug}>
                <button type="button" className={session.slug === clientSlug ? "on" : ""} onClick={() => setClientSlug(session.slug)}>
                  <strong>{session.name}</strong>
                  <span>{session.last.title}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="nai-muted">O que você criar aqui fica listado por cliente.</p>
        )}
        <p className="nai-muted nai-history-foot">Histórico salvo neste navegador.</p>
      </aside>

      <main className="nai-main">
        <div className="nai-thread">
          {!clientEntries.length && !recipe ? (
            <div className="nai-hero">
              <p className="nai-eyebrow">Uma IA para toda a operação · modo determinístico</p>
              <h2>O que vamos construir agora?</h2>
              <p className="nai-muted">
                Cole os roteiros, o link do Docs ou escreva o pedido. Eu monto a diária, o plano, a rotina, o fluxo ou a automação{client ? ` de ${client.name}` : ""} — e mostro tudo antes de criar.
              </p>
              <div className="nai-actions">
                {ACTIONS.map((action) => (
                  <button type="button" key={action.key} className="nai-action" onClick={() => openRecipe(action.key)}>
                    <strong>{action.title}</strong>
                    <span>{action.blurb}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {clientEntries.map((entry) => (
            <article key={entry.id} className={`nai-entry${entry.error ? " is-error" : ""}${entry.running ? " is-running" : ""}`}>
              <header>
                <strong>{entry.title}</strong>
                <time>{new Date(entry.at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</time>
              </header>
              {entry.note ? <p className="nai-muted">{entry.note}</p> : null}
              {entry.preview.length ? (
                <ul className="nai-preview">
                  {entry.preview.map((line, index) => (
                    <li key={index} className={line.indent ? "is-indent" : ""}>
                      <span aria-hidden>{line.icon}</span>
                      <b>{line.text}</b>
                      {line.detail ? <em>{line.detail}</em> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              {entry.running ? <p className="nai-muted">Criando…</p> : null}
              {entry.created.length ? (
                <div className="nai-created">
                  <span>Criado:</span>
                  {entry.created.slice(0, 12).map((item) =>
                    item.kind === "automation" ? (
                      <Link key={`${item.kind}-${item.id}`} href="/admin/northai/automacoes">⚙ {item.title}</Link>
                    ) : (
                      <Link key={`${item.kind}-${item.id}`} href={`/admin/kanban?task=${item.id}`}>{item.title}</Link>
                    ),
                  )}
                  {entry.created.length > 12 ? <em>+ {entry.created.length - 12}</em> : null}
                </div>
              ) : null}
              {entry.error ? <p className="admin-error">{entry.error}</p> : null}
            </article>
          ))}

          {clientEntries.length && !recipe ? (
            <div className="nai-actions is-compact">
              {ACTIONS.map((action) => (
                <button type="button" key={action.key} className="nai-action" onClick={() => openRecipe(action.key)}>
                  <strong>{action.title}</strong>
                </button>
              ))}
            </div>
          ) : null}

          {recipe && recipe !== "analise" ? (
            <section className="nai-recipe" aria-label={RECIPE_TITLE[recipe]}>
              <header>
                <strong>{RECIPE_TITLE[recipe]}{client ? ` · ${client.name}` : ""}</strong>
                <button type="button" className="kb-modal-close" onClick={() => setRecipe(null)} aria-label="Fechar receita">✕</button>
              </header>

              {recipe === "diaria" ? (
                <div className="nai-form">
                  <div className="nai-fields">
                    <label className="admin-field"><span>Data da gravação</span>
                      <input type="date" value={shoot.shootDate} onChange={(event) => setShoot((current) => ({ ...current, shootDate: event.target.value }))} />
                    </label>
                    <label className="admin-field"><span>Responsável</span>{assigneeSelect(shoot.assignee, (assignee) => setShoot((current) => ({ ...current, assignee })))}</label>
                    {shootTypes.length > 1 ? (
                      <label className="admin-field"><span>Tipo de entrega</span>
                        <select value={shoot.typeKey} onChange={(event) => setShoot((current) => ({ ...current, typeKey: event.target.value }))}>
                          {shootTypes.map((type) => <option key={type.key} value={type.key}>{type.label}</option>)}
                        </select>
                      </label>
                    ) : null}
                    <label className="admin-toggle nai-toggle">
                      <input type="checkbox" checked={shoot.withPlan} onChange={(event) => setShoot((current) => ({ ...current, withPlan: event.target.checked }))} />
                      <span className="sw" />
                      <span>Agrupar num plano da diária</span>
                    </label>
                  </div>
                  {shoot.docUrl ? <p className="nai-muted">Roteiros do documento: <a href={shoot.docUrl} target="_blank" rel="noreferrer">abrir original ↗</a> · cópia no GED</p> : null}

                  <p className="nai-label">Publicações — o mesmo roteiro e a mesma gravação, edição e publicação próprias</p>
                  <div className="nai-pieces">
                    {shoot.pieces.map((piece, index) => (
                      <div className="nai-piece" key={index}>
                        <span className="nai-piece-n">{index + 1}</span>
                        <input aria-label={`Título da publicação ${index + 1}`} value={piece.title} onChange={(event) => setShoot((current) => ({ ...current, pieces: current.pieces.map((entry, i) => (i === index ? { ...entry, title: event.target.value } : entry)) }))} />
                        <select aria-label={`Formato da publicação ${index + 1}`} value={piece.format} onChange={(event) => setShoot((current) => ({ ...current, pieces: current.pieces.map((entry, i) => (i === index ? { ...entry, format: event.target.value as NorthFormatKey } : entry)) }))}>
                          {NORTH_FORMATS.map((format) => <option key={format.key} value={format.key}>{format.label}</option>)}
                        </select>
                        <input
                          type="date"
                          aria-label={`Publicação ${index + 1} em`}
                          title="Data de publicação"
                          value={piece.publishDate ?? (shoot.shootDate ? defaultPublishDate(shoot.shootDate, index) : "")}
                          onChange={(event) => setShoot((current) => ({ ...current, pieces: current.pieces.map((entry, i) => (i === index ? { ...entry, publishDate: event.target.value || null } : entry)) }))}
                        />
                        <button type="button" className="tm-member-unlink" aria-label={`Remover publicação ${index + 1}`} onClick={() => setShoot((current) => ({ ...current, pieces: current.pieces.filter((_, i) => i !== index) }))}>✕</button>
                      </div>
                    ))}
                    <div className="nai-add">
                      {NORTH_FORMATS.map((format) => (
                        <button type="button" key={format.key} className="kb-chip" onClick={() => setShoot((current) => ({ ...current, pieces: [...current.pieces, { title: pieceTitle(format.key, current.pieces.filter((piece) => piece.format === format.key).length), format: format.key, publishDate: null, body: "" }] }))}>
                          + {format.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <details className="nai-scripts" open={!shoot.pieces.length}>
                    <summary>Roteiros colados {shoot.scriptsText ? "(texto do documento)" : ""}</summary>
                    <textarea rows={6} value={shoot.scriptsText} onChange={(event) => setShoot((current) => ({ ...current, scriptsText: event.target.value }))} placeholder="Cole aqui o texto dos roteiros. Títulos como “Roteiro 1 — Reels” separam as publicações." />
                    <button type="button" className="admin-btn ghost" disabled={!shoot.scriptsText.trim()} onClick={() => setShoot((current) => ({ ...current, pieces: parseScripts(current.scriptsText).map((script) => ({ title: script.title, format: script.format, publishDate: null, body: script.body })) }))}>
                      Separar roteiros
                    </button>
                  </details>
                </div>
              ) : null}

              {recipe === "plano" ? (
                <div className="nai-form">
                  <div className="nai-fields">
                    <label className="admin-field nai-wide"><span>Nome do plano</span>
                      <input value={plan.title} onChange={(event) => setPlan((current) => ({ ...current, title: event.target.value }))} placeholder="Plano de conteúdo — outubro" />
                    </label>
                    <label className="admin-field"><span>Início</span>
                      <input type="date" value={plan.startDate} onChange={(event) => setPlan((current) => ({ ...current, startDate: event.target.value }))} />
                    </label>
                    <label className="admin-field"><span>Responsável</span>{assigneeSelect(plan.assignee, (assignee) => setPlan((current) => ({ ...current, assignee })))}</label>
                  </div>
                  <p className="nai-label">Volume de conteúdo</p>
                  <div className="pac-panel nai-qty">
                    {NORTH_FORMATS.map((format) => (
                      <QtyField key={format.key} label={format.plural} value={plan.counts[format.key] ?? 0} onChange={(next) => setPlan((current) => ({ ...current, counts: { ...current.counts, [format.key]: next } }))} />
                    ))}
                  </div>
                  <label className="admin-field"><span>Outras atividades (uma por linha)</span>
                    <textarea rows={3} value={plan.extra} onChange={(event) => setPlan((current) => ({ ...current, extra: event.target.value }))} placeholder={"Ajustar bio do Instagram\nCriar Google Empresa"} />
                  </label>
                </div>
              ) : null}

              {recipe === "rotina" ? (
                <div className="nai-form">
                  <div className="nai-fields">
                    <label className="admin-field nai-wide"><span>Nome</span>
                      <input value={routine.title} onChange={(event) => setRoutine((current) => ({ ...current, title: event.target.value }))} placeholder="Assessoria semanal" />
                    </label>
                    <label className="admin-field"><span>Repete</span>
                      <select value={routine.cadence} onChange={(event) => setRoutine((current) => ({ ...current, cadence: event.target.value as Cadence | "" }))}>
                        <option value="">Uma vez</option>
                        <option value="semanal">Toda semana</option>
                        <option value="quinzenal">A cada 15 dias</option>
                        <option value="mensal">Todo mês</option>
                      </select>
                    </label>
                    <label className="admin-field"><span>{routine.cadence ? "Primeira data" : "Data"}</span>
                      <input type="date" value={routine.startDate} onChange={(event) => setRoutine((current) => ({ ...current, startDate: event.target.value }))} />
                    </label>
                    <label className="admin-field"><span>Responsável</span>{assigneeSelect(routine.assignee, (assignee) => setRoutine((current) => ({ ...current, assignee })))}</label>
                  </div>
                  {routine.cadence === "semanal" || routine.cadence === "quinzenal" ? (
                    <div className="nai-weekdays" role="group" aria-label="Dias da semana">
                      {WEEKDAYS.map((label, day) => (
                        <button type="button" key={label} className={`kb-chip${routine.weekdays.includes(day) ? " on" : ""}`} aria-pressed={routine.weekdays.includes(day)} onClick={() => setRoutine((current) => ({ ...current, weekdays: current.weekdays.includes(day) ? current.weekdays.filter((d) => d !== day) : [...current.weekdays, day].sort() }))}>
                          {label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <label className="admin-field"><span>Descrição</span>
                    <textarea rows={2} value={routine.description} onChange={(event) => setRoutine((current) => ({ ...current, description: event.target.value }))} />
                  </label>
                </div>
              ) : null}

              {recipe === "fluxo" ? (
                <div className="nai-form">
                  <div className="nai-fields">
                    <label className="admin-field nai-wide"><span>Título</span>
                      <input value={flow.title} onChange={(event) => setFlow((current) => ({ ...current, title: event.target.value }))} placeholder="Reels da promoção" />
                    </label>
                    <label className="admin-field"><span>Tipo</span>
                      <select value={flow.typeKey} onChange={(event) => setFlow((current) => ({ ...current, typeKey: event.target.value }))}>
                        {deliveryTypes.map((type) => <option key={type.key} value={type.key}>{type.label}</option>)}
                      </select>
                    </label>
                    <label className="admin-field"><span>Formato</span>
                      <select value={flow.format} onChange={(event) => setFlow((current) => ({ ...current, format: event.target.value as NorthFormatKey }))}>
                        {NORTH_FORMATS.map((format) => <option key={format.key} value={format.key}>{format.label}</option>)}
                      </select>
                    </label>
                    <label className="admin-field"><span>Prazo</span>
                      <input type="date" value={flow.dueDate} onChange={(event) => setFlow((current) => ({ ...current, dueDate: event.target.value }))} />
                    </label>
                    <label className="admin-field"><span>Responsável</span>{assigneeSelect(flow.assignee, (assignee) => setFlow((current) => ({ ...current, assignee })))}</label>
                    {context?.plans.length ? (
                      <label className="admin-field"><span>Plano de ação</span>
                        <select value={flow.planId} onChange={(event) => setFlow((current) => ({ ...current, planId: event.target.value }))}>
                          <option value="">Sem plano</option>
                          {context.plans.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
                        </select>
                      </label>
                    ) : null}
                  </div>
                  <div className="pac-panel nai-qty">
                    <QtyField label="Quantidade de entregas" value={flow.count} onChange={(next) => setFlow((current) => ({ ...current, count: Math.max(1, next) }))} />
                  </div>
                </div>
              ) : null}

              {recipe === "automacao" ? (
                <div className="nai-form">
                  <div className="nai-fields">
                    <label className="admin-field nai-wide"><span>Automação</span>
                      <select value={automation.automationKey} onChange={(event) => setAutomation((current) => ({ ...current, automationKey: event.target.value }))}>
                        {AUTOMATION_KEYS.map((key) => <option key={key} value={key}>{AUTOMATION_DEFINITIONS[key].label}</option>)}
                      </select>
                    </label>
                  </div>
                  <p className="nai-muted">{AUTOMATION_DEFINITIONS[automation.automationKey as keyof typeof AUTOMATION_DEFINITIONS]?.description}</p>
                  <div className="nai-weekdays" role="radiogroup" aria-label="Card-alvo">
                    <button type="button" className={`kb-chip${automation.mode === "new" ? " on" : ""}`} aria-pressed={automation.mode === "new"} onClick={() => setAutomation((current) => ({ ...current, mode: "new" }))}>Criar rotina para a automação</button>
                    <button type="button" className={`kb-chip${automation.mode === "existing" ? " on" : ""}`} aria-pressed={automation.mode === "existing"} disabled={!context?.targets.length} onClick={() => setAutomation((current) => ({ ...current, mode: "existing" }))}>Usar rotina existente</button>
                  </div>
                  {automation.mode === "existing" ? (
                    <label className="admin-field"><span>Rotina</span>
                      <select value={automation.targetTaskId} onChange={(event) => setAutomation((current) => ({ ...current, targetTaskId: event.target.value }))}>
                        <option value="">Escolher…</option>
                        {(context?.targets ?? []).map((target) => <option key={target.id} value={target.id}>{target.title}</option>)}
                      </select>
                    </label>
                  ) : (
                    <div className="nai-fields">
                      <label className="admin-field nai-wide"><span>Nome da rotina</span>
                        <input value={automation.newTitle} onChange={(event) => setAutomation((current) => ({ ...current, newTitle: event.target.value }))} />
                      </label>
                      <label className="admin-field"><span>Repete</span>
                        <select value={automation.cadence} onChange={(event) => setAutomation((current) => ({ ...current, cadence: event.target.value as Cadence }))}>
                          <option value="semanal">Toda semana</option>
                          <option value="quinzenal">A cada 15 dias</option>
                          <option value="mensal">Todo mês</option>
                        </select>
                      </label>
                      <label className="admin-field"><span>Começa</span>
                        <input type="date" value={automation.startDate} onChange={(event) => setAutomation((current) => ({ ...current, startDate: event.target.value }))} />
                      </label>
                      <label className="admin-field"><span>Responsável</span>{assigneeSelect(automation.assignee, (assignee) => setAutomation((current) => ({ ...current, assignee })))}</label>
                    </div>
                  )}
                </div>
              ) : null}

              <div className="nai-plan">
                <p className="nai-label">Vai criar</p>
                {built.value ? (
                  <ul className="nai-preview">
                    {built.value.preview.map((line, index) => (
                      <li key={index} className={line.indent ? "is-indent" : ""}>
                        <span aria-hidden>{line.icon}</span>
                        <b>{line.text}</b>
                        {line.detail ? <em>{line.detail}</em> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="nai-muted">{built.problem}</p>
                )}
                <div className="nai-plan-actions">
                  <button type="button" className="admin-btn ghost" onClick={() => setRecipe(null)}>Cancelar</button>
                  <button type="button" className="admin-btn primary" disabled={!built.value || busy} onClick={() => void run()}>
                    {busy ? "Criando…" : "Confirmar e criar"}
                  </button>
                </div>
              </div>
            </section>
          ) : null}
        </div>

        <form className="nai-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
          {notice ? <p className="nai-notice" role="status">{notice}</p> : null}
          <div className="nai-composer-box">
            <select className="nai-client" aria-label="Cliente" value={clientSlug ?? ""} onChange={(event) => setClientSlug(event.target.value || null)}>
              <option value="">Escolher cliente</option>
              {clients.map((entry) => <option key={entry.slug} value={entry.slug}>{entry.name}</option>)}
            </select>
            <textarea
              rows={composer.includes("\n") ? 4 : 1}
              value={composer}
              onChange={(event) => setComposer(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }}
              placeholder="Cole os roteiros ou o link do Docs, ou escreva: 3 reels e 1 carrossel, gravação 22/09"
              aria-label="Pedido para o NorthAi"
            />
            <button type="submit" className="admin-btn primary nai-send" disabled={!composer.trim()} aria-label="Enviar">↑</button>
          </div>
          <p className="nai-muted nai-composer-foot">Enter envia · Shift+Enter quebra linha · nada é criado sem a sua confirmação</p>
        </form>
      </main>

      <aside className="nai-context" aria-label="Contexto do cliente">
        {!client ? (
          <div className="nai-card"><p className="nai-muted">Escolha um cliente para ver o que já está amarrado e o que falta.</p></div>
        ) : contextError ? (
          <div className="nai-card"><p className="admin-error">{contextError}</p></div>
        ) : !context ? (
          <div className="nai-card"><p className="nai-muted">Carregando {client.name}…</p></div>
        ) : (
          <>
            <div className="nai-card">
              <div className="nai-card-head">
                <strong>Cadastro conectado</strong>
                <b className="nai-percent">{context.insight.readiness.percent}%</b>
              </div>
              <div className="nai-bar" role="progressbar" aria-valuenow={context.insight.readiness.percent} aria-valuemin={0} aria-valuemax={100}>
                <span style={{ width: `${context.insight.readiness.percent}%` }} />
              </div>
              <ul className="nai-checks">
                {context.insight.readiness.checks.map((check) => (
                  <li key={check.key} className={check.ok ? "ok" : ""}><span aria-hidden>{check.ok ? "✓" : "○"}</span>{check.label}</li>
                ))}
              </ul>
            </div>
            <div className="nai-card nai-numbers">
              <div><strong className={context.insight.numbers.atrasadas ? "t-red" : ""}>{context.insight.numbers.atrasadas}</strong><span>atrasadas</span></div>
              <div><strong>{context.insight.numbers.paradas}</strong><span>paradas</span></div>
              <div><strong>{context.insight.numbers.semana}</strong><span>na semana</span></div>
            </div>
            <div className="nai-card">
              <p className="nai-side-title">O que falta amarrar</p>
              {context.insight.gaps.length ? (
                <ul className="nai-gaps">
                  {context.insight.gaps.map((gap) => (
                    <li key={gap.key} className={`sev-${gap.severity}`}>
                      <div>
                        <strong>{gap.title}</strong>
                        <span>{gap.detail}</span>
                        {gap.tasks.length ? (
                          <span className="nai-gap-links">
                            {gap.tasks.slice(0, 3).map((task) => <Link key={task.id} href={`/admin/kanban?task=${task.id}`}>{task.title || "abrir"}</Link>)}
                          </span>
                        ) : null}
                      </div>
                      {gap.recipe ? <button type="button" className="admin-btn ghost" onClick={() => openRecipe(gap.recipe!, gap.prefill)}>Resolver</button> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="nai-muted">Nada pendente.</p>
              )}
            </div>
            <div className="nai-card">
              <p className="nai-side-title">GED · {context.ged.provider === "drive" ? "Drive da plataforma" : "armazenamento interno"}</p>
              <ul className="nai-ged">
                {context.ged.folders.map((folder) => <li key={folder.key}>{folder.path.split("/").pop()}</li>)}
              </ul>
              <p className="nai-muted">Clientes/{client.name} ({client.slug}) · links colados aqui são copiados para dentro.</p>
            </div>
            <p className="nai-muted nai-context-foot">Atualizado {shortDate(context.today)} · <button type="button" className="nai-link" onClick={() => void loadContext(clientSlug)}>recarregar</button></p>
          </>
        )}
      </aside>
    </div>
  );
}
