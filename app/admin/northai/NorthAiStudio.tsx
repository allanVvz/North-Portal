"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NorthAiClientContext, NorthAiGap } from "@/lib/northai/context";
import type { BlueprintResult } from "@/lib/northai/blueprint";
import { parseCommand, type RecipeKey } from "@/lib/northai/commandParser";
import { parseScripts } from "@/lib/northai/scriptParser";
import { applyCommand, applyPrefill, buildRecipe, initialDrafts, piecesFromScripts, type FormRecipe, type StudioDrafts } from "@/lib/northai/drafts";
import { agencyToday } from "@/lib/time/agency";
import NorthAiTabs from "./NorthAiTabs";
import ComboField from "./studio/ComboField";
import ContextPanel from "./studio/ContextPanel";
import ExecutionResult from "./studio/ExecutionResult";
import GuidedForm from "./studio/GuidedForm";
import PlanPreview from "./studio/PlanPreview";
import SessionHistory from "./studio/SessionHistory";
import StudioComposer from "./studio/StudioComposer";
import { AssistantBubble, StatusPill, UserBubble } from "./studio/Bubbles";
import { RECIPE_META, RECIPE_ORDER } from "./studio/meta";
import { useStudioSession } from "./studio/useStudioSession";
import type { ClientLite, RecipeMessage, StudioMessage, TypeLite } from "./studio/types";

// Estúdio do NorthAi — uma conversa por cliente.
//
// PEDIDO → RASCUNHO → PRÉVIA → CONFIRMAÇÃO → RESULTADO. O que foi entendido e o
// que vai ser criado é decidido em lib/northai/drafts.ts (puro); criar só
// acontece em POST /api/admin/northai/execute, depois de "Confirmar e criar".
// Este componente guarda os quatro estados — cliente, conversa, rascunho e
// execução — e desenha.

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const now = () => new Date().toISOString();

export default function NorthAiStudio({ clients, assignees, types }: { clients: ClientLite[]; assignees: string[]; types: TypeLite[] }) {
  const today = agencyToday();
  const shootTypes = useMemo(() => types.filter((type) => type.shootReady), [types]);
  const deliveryTypes = useMemo(() => types.filter((type) => type.behavior === "entrega"), [types]);
  const freshDrafts = useCallback(
    () => initialDrafts(today, { shootTypeKey: shootTypes[0]?.key ?? "", deliveryTypeKey: deliveryTypes[0]?.key ?? "" }),
    [today, shootTypes, deliveryTypes],
  );

  // cliente + conversa
  const session = useStudioSession(clients);
  const slug = session.activeClient;
  const client = clients.find((entry) => entry.slug === slug) ?? null;
  const messages = useMemo(() => (slug ? session.threads[slug] ?? [] : []), [session.threads, slug]);

  // rascunho
  const [drafts, setDrafts] = useState<StudioDrafts>(freshDrafts);
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = messages.find((message): message is RecipeMessage => message.id === activeId && message.role === "assistant" && message.kind === "recipe") ?? null;

  // contexto
  const [context, setContext] = useState<NorthAiClientContext | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState("");

  // composer + execução + gavetas
  const [composer, setComposer] = useState("");
  const [busy, setBusy] = useState(false);
  const [drawer, setDrawer] = useState<"none" | "history" | "context">("none");
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadContext = useCallback(async (target: string | null) => {
    setContextError("");
    if (!target) { setContext(null); return; }
    setContextLoading(true);
    try {
      const res = await fetch(`/api/admin/northai/context?slug=${encodeURIComponent(target)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "erro desconhecido");
      setContext(data as NorthAiClientContext);
    } catch (error) {
      setContext(null);
      setContextError(error instanceof Error ? error.message : "erro desconhecido");
    } finally {
      setContextLoading(false);
    }
  }, []);

  useEffect(() => { void loadContext(slug); }, [slug, loadContext]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, activeId]);

  const built = useMemo(
    () => (active ? buildRecipe(active.recipe, drafts, { client, deliveryTypes, routines: context?.options.routines ?? [], today }) : { value: null, problem: null }),
    [active, drafts, client, deliveryTypes, context, today],
  );

  /** Descarta o pedido em andamento (troca de cliente, novo pedido). */
  const cancelActive = useCallback((note: string) => {
    if (!slug || !active || (active.status !== "rascunho" && active.status !== "revisar")) return;
    session.patch(slug, active.id, { status: "cancelado", note });
    setActiveId(null);
  }, [slug, active, session]);

  function changeClient(next: string | null) {
    if (next === slug) return;
    cancelActive("Rascunho descartado ao trocar de cliente.");
    setActiveId(null);
    setDrafts(freshDrafts());
    setContext(null);
    session.setActiveClient(next);
    setDrawer("none");
  }

  function say(target: string, text: string, tone?: "info" | "warn" | "error") {
    session.append(target, { id: newId(), at: now(), role: "assistant", kind: "text", text, tone });
  }

  function startRecipe(target: ClientLite, recipe: RecipeKey, options: { userText?: string | null; understood?: string | null; nextDrafts?: StudioDrafts } = {}) {
    cancelActive("Substituído por outro pedido.");
    if (options.userText !== null) session.append(target.slug, { id: newId(), at: now(), role: "user", text: options.userText ?? RECIPE_META[recipe].ask });
    if (recipe === "analise") {
      if (!context || context.identity.slug !== target.slug) {
        say(target.slug, "Ainda estou carregando o contexto deste cliente. Tente de novo em instantes.", "warn");
        return;
      }
      const op = context.operation;
      session.append(target.slug, {
        id: newId(),
        at: now(),
        role: "assistant",
        kind: "analysis",
        percent: context.knowledge.percent,
        summary: `${RECIPE_META.analise.intro(target.name)} ${op.abertas} tarefas abertas, ${op.atrasadas} atrasadas, ${op.paradas} paradas${op.proximaGravacao ? `, próxima gravação em ${op.proximaGravacao.date.slice(8, 10)}/${op.proximaGravacao.date.slice(5, 7)}` : ", sem gravação agendada"}.`,
        gaps: context.gaps.map((gap) => ({ title: gap.title, detail: gap.detail, severity: gap.severity })),
      });
      return;
    }
    setDrafts(options.nextDrafts ?? freshDrafts());
    say(target.slug, options.understood ?? RECIPE_META[recipe].intro(target.name));
    const id = newId();
    session.append(target.slug, { id, at: now(), role: "assistant", kind: "recipe", recipe, title: RECIPE_META[recipe].title, status: "rascunho", preview: [], result: null });
    setActiveId(id);
  }

  function pick(recipe: RecipeKey) {
    if (!client) return;
    startRecipe(client, recipe);
  }

  function resolveGap(gap: NorthAiGap) {
    if (!client || !gap.recipe) return;
    setDrawer("none");
    startRecipe(client, gap.recipe, { userText: `Resolver: ${gap.title}`, nextDrafts: applyPrefill(freshDrafts(), gap.recipe, gap.prefill) });
  }

  async function importLink(target: ClientLite, url: string) {
    const noteId = newId();
    session.append(target.slug, { id: noteId, at: now(), role: "assistant", kind: "text", text: "Copiando o arquivo para os arquivos do cliente…" });
    try {
      const res = await fetch("/api/admin/northai/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, slug: target.slug }) });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Não foi possível copiar o arquivo.");
      const scripts = (data.scripts ?? []) as ReturnType<typeof parseScripts>;
      session.patch(target.slug, noteId, { text: `Copiei “${data.document?.fileName ?? "o arquivo"}” para ${String(data.folderPath).split("/").pop()}.` } as Partial<StudioMessage>);
      if (scripts.length) {
        const base = freshDrafts();
        startRecipe(target, "diaria", {
          userText: null,
          understood: `Separei ${scripts.length === 1 ? "1 roteiro" : `${scripts.length} roteiros`} do documento. Informe a data da gravação e confira os formatos.`,
          nextDrafts: { ...base, diaria: { ...base.diaria, docUrl: url, scriptsText: data.text ?? "", pieces: piecesFromScripts(scripts) } },
        });
      }
    } catch (error) {
      session.patch(target.slug, noteId, { text: error instanceof Error ? error.message : "Não foi possível copiar o arquivo.", tone: "error" } as Partial<StudioMessage>);
    }
  }

  async function send() {
    const text = composer.trim();
    if (!text || busy) return;
    const parsed = parseCommand(text, { clients, today });
    const target = clients.find((entry) => entry.slug === (parsed.clientSlug ?? slug)) ?? null;
    if (!target) return;
    if (target.slug !== slug) changeClient(target.slug);
    setComposer("");
    session.append(target.slug, { id: newId(), at: now(), role: "user", text });

    if (parsed.links.length) {
      await importLink(target, parsed.links[0]);
      return;
    }
    const lines = text.split("\n").filter((line) => line.trim()).length;
    if ((lines >= 4 || text.length > 280) && (!parsed.intent || parsed.intent === "diaria")) {
      const scripts = parseScripts(text);
      const base = freshDrafts();
      startRecipe(target, "diaria", {
        userText: null,
        understood: `Separei ${scripts.length === 1 ? "1 roteiro" : `${scripts.length} roteiros`}. Informe a data da gravação e confira os formatos.`,
        nextDrafts: { ...base, diaria: { ...base.diaria, scriptsText: text, shootDate: parsed.dates[0] ?? "", pieces: piecesFromScripts(scripts) } },
      });
      return;
    }
    const applied = applyCommand(freshDrafts(), parsed, text);
    if (!applied.intent) {
      say(target.slug, "Não entendi o pedido. Escolha uma das opções abaixo ou escreva algo como “3 reels e 1 carrossel, gravação 22/09”.", "warn");
      return;
    }
    startRecipe(target, applied.intent, { userText: null, understood: applied.understood, nextDrafts: applied.drafts });
  }

  function review() {
    if (!slug || !active || !built.value) return;
    session.patch(slug, active.id, { status: "revisar" });
  }

  function edit() {
    if (!slug || !active) return;
    session.patch(slug, active.id, { status: "rascunho" });
  }

  function discard() {
    cancelActive("Cancelado — nada foi criado.");
  }

  async function confirm() {
    if (!slug || !active || !built.value || busy) return;
    const { blueprint, preview } = built.value;
    const messageId = active.id;
    setBusy(true);
    session.patch(slug, messageId, { status: "criando", preview });
    let result: BlueprintResult;
    try {
      const res = await fetch("/api/admin/northai/execute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ blueprint }) });
      const data = await res.json().catch(() => null);
      result = {
        created: Array.isArray(data?.created) ? data.created : [],
        error: res.ok ? null : data?.error ?? "Não foi possível criar.",
      };
    } catch {
      result = { created: [], error: "Falha de rede ao criar." };
    }
    const failedClean = Boolean(result.error) && !result.created.length;
    session.patch(slug, messageId, { status: result.error ? "erro" : "criado", result, title: result.error ? RECIPE_META[active.recipe].title : RECIPE_META[active.recipe].done });
    // Erro sem nada criado: o rascunho continua editável para tentar de novo.
    if (!failedClean) setActiveId(null);
    setBusy(false);
    void loadContext(slug);
  }

  function restart() {
    setActiveId(null);
    setDrafts(freshDrafts());
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }

  const hasConversation = messages.length > 0;
  const recipeOpen = Boolean(active && (active.status === "rascunho" || active.status === "revisar" || active.status === "criando" || active.status === "erro"));

  return (
    <div className={`nai-studio${drawer !== "none" ? " has-drawer" : ""}`}>
      <div className="nai-col">
        <div className="nai-scroll" ref={scrollRef}>
          <div className="nai-scroll-inner">
            <header className="nai-header">
              <p className="nai-crumb">NorthAi</p>
              <NorthAiTabs />
              <div className="nai-workspace">
                <div>
                  <p className="nai-workspace-label">Cliente ativo</p>
                  <h1 className="nai-workspace-title">{client ? client.name : "Escolha um cliente"}</h1>
                </div>
                <ComboField
                  label="Cliente"
                  size="lg"
                  value={slug ?? ""}
                  options={clients.map((entry) => ({ value: entry.slug, label: entry.name }))}
                  placeholder="trocar"
                  onChange={(value) => changeClient(value || null)}
                />
                {context && client ? <span className="nai-workspace-meta">Cadastro conectado {context.knowledge.percent}%</span> : null}
              </div>
            </header>

            <div className="nai-thread" aria-live="polite">
              {!client ? (
                <AssistantBubble>Escolha o cliente acima. Tudo o que você pedir aqui acontece dentro da operação dele.</AssistantBubble>
              ) : !hasConversation ? (
                <>
                  <AssistantBubble>
                    Olá! O que vamos construir para <b>{client.name}</b>? Cole os roteiros, o link do Docs ou escreva o pedido — eu mostro tudo antes de criar.
                  </AssistantBubble>
                  <div className="nai-actions">
                    {RECIPE_ORDER.map((key) => (
                      <button type="button" key={key} className="nai-action" onClick={() => pick(key)}>
                        <strong>{RECIPE_META[key].title}</strong>
                        <span>{RECIPE_META[key].blurb}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : null}

              {client ? messages.map((message) => {
                if (message.role === "user") return <UserBubble key={message.id} text={message.text} />;
                if (message.kind === "text") return <AssistantBubble key={message.id} tone={message.tone}>{message.text}</AssistantBubble>;
                if (message.kind === "analysis") {
                  return (
                    <AssistantBubble key={message.id} card>
                      <p className="nai-bubble-title">Análise da operação <span className="nai-status s-revisar">Cadastro {message.percent}%</span></p>
                      <p>{message.summary}</p>
                      {message.gaps.length ? (
                        <ul className="nai-analysis">
                          {message.gaps.map((gap, index) => <li key={index} className={`sev-${gap.severity}`}><b>{gap.title}</b> — {gap.detail}</li>)}
                        </ul>
                      ) : <p className="nai-muted">Nada pendente — o cliente está amarrado.</p>}
                      <p className="nai-muted">Use “Resolver” no contexto do cliente para começar por uma lacuna.</p>
                    </AssistantBubble>
                  );
                }
                const isActive = message.id === activeId;
                return (
                  <AssistantBubble key={message.id} card>
                    <p className="nai-bubble-title">{message.title} <StatusPill status={message.status} /></p>
                    {isActive && message.status === "rascunho" ? (
                      <>
                        <GuidedForm
                          recipe={message.recipe as FormRecipe}
                          drafts={drafts}
                          onDrafts={(update) => setDrafts(update)}
                          assignees={assignees}
                          shootTypes={shootTypes}
                          deliveryTypes={deliveryTypes}
                          plans={context?.options.plans ?? []}
                          routines={context?.options.routines ?? []}
                        />
                        {built.problem ? <p className="nai-muted nai-missing">Falta: {built.problem}</p> : null}
                        <div className="nai-bubble-actions">
                          <button type="button" className="admin-btn ghost" onClick={discard}>Cancelar</button>
                          <button type="button" className="admin-btn primary" disabled={!built.value} onClick={review}>Ver o que será criado</button>
                        </div>
                      </>
                    ) : isActive && (message.status === "revisar" || message.status === "erro") && built.value ? (
                      <>
                        <p className="nai-preview-head">O que será criado para {client?.name}</p>
                        <PlanPreview lines={built.value.preview} />
                        {message.status === "erro" && message.result?.error ? <p className="admin-error">{message.result.error}</p> : null}
                        <div className="nai-bubble-actions">
                          <button type="button" className="admin-btn ghost" onClick={edit} disabled={busy}>Editar</button>
                          <button type="button" className="admin-btn primary" onClick={() => void confirm()} disabled={busy}>Confirmar e criar</button>
                        </div>
                      </>
                    ) : message.status === "criando" ? (
                      <>
                        <PlanPreview lines={message.preview} compact />
                        <p className="nai-muted">Criando…</p>
                      </>
                    ) : message.status === "criado" || message.status === "erro" ? (
                      <>
                        {message.preview.length ? <PlanPreview lines={message.preview} compact /> : null}
                        <ExecutionResult message={message} onRestart={restart} />
                      </>
                    ) : (
                      <p className="nai-muted">{message.note ?? "Cancelado — nada foi criado."}</p>
                    )}
                  </AssistantBubble>
                );
              }) : null}
            </div>
          </div>
        </div>

        <StudioComposer
          value={composer}
          onChange={setComposer}
          onSend={() => void send()}
          onPick={pick}
          showSuggestions={Boolean(client) && hasConversation && !recipeOpen}
          clientName={client?.name ?? null}
          disabled={!client || busy}
          onOpenHistory={() => setDrawer((current) => (current === "history" ? "none" : "history"))}
          onOpenContext={() => setDrawer((current) => (current === "context" ? "none" : "context"))}
        />
      </div>

      <aside className={`nai-side${drawer === "context" ? " is-open" : ""}`} aria-label="Contexto do cliente">
        <ContextPanel
          clientName={client?.name ?? null}
          context={context && client && context.identity.slug === client.slug ? context : null}
          loading={contextLoading}
          error={contextError}
          onResolve={resolveGap}
          onReload={() => void loadContext(slug)}
          onClose={drawer === "context" ? () => setDrawer("none") : undefined}
        />
      </aside>

      {drawer === "history" ? (
        <aside className="nai-drawer is-left" aria-label="Conversas recentes">
          <SessionHistory clients={clients} threads={session.threads} activeClient={slug} onPick={(next) => changeClient(next)} onClose={() => setDrawer("none")} />
        </aside>
      ) : null}
      {drawer !== "none" ? <button type="button" className="nai-backdrop" aria-label="Fechar" onClick={() => setDrawer("none")} /> : null}
    </div>
  );
}
