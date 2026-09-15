"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NorthAiClientContext, NorthAiGap } from "@/lib/northai/context";
import type { BlueprintResult } from "@/lib/northai/blueprint";
import { parseCommand, type ParsedCommand, type RecipeKey } from "@/lib/northai/commandParser";
import { parseScripts } from "@/lib/northai/scriptParser";
import { applyCommand, applyPrefill, buildRecipe, initialDrafts, piecesFromScripts, recipeSources, type StudioDrafts } from "@/lib/northai/drafts";
import { resolveNorthAiContext } from "@/lib/northai/contextResolution";
import { cacheFail, cacheResolve, cacheStart, type ContextCache } from "@/lib/northai/contextCache";
import { filterClients, type ComposerMention } from "@/lib/northai/mentions";
import { agencyToday } from "@/lib/time/agency";
import NorthAiTabs from "./NorthAiTabs";
import ClientIdentity from "./studio/ClientIdentity";
import ClientMentionPicker from "./studio/ClientMentionPicker";
import ContextInspector from "./studio/ContextInspector";
import OperationCard from "./studio/OperationCard";
import SessionHistory from "./studio/SessionHistory";
import StudioComposer from "./studio/StudioComposer";
import { AssistantTurn, groupTurns, UserTurn } from "./studio/Turns";
import { RECIPE_META, RECIPE_ORDER } from "./studio/meta";
import { useStudioSession } from "./studio/useStudioSession";
import type { ChoiceMessage, ClientLite, RecipeMessage, StudioMessage, TypeLite } from "./studio/types";

// Estúdio do NorthAi — o NorthAi operando dentro do contexto de um cliente.
//
//   entrada (texto + @cliente com id)
//     → resolução de contexto (lib/northai/contextResolution.ts)
//     → intenção e rascunho (lib/northai/drafts.ts, puro)
//     → Blueprint e prévia → "Confirmar e criar" → executor → resultado
//
// Este componente guarda os estados — cliente, conversa, composer, rascunho,
// cache de contexto, execução — e liga as peças de ./studio. Um LLM (R4.11)
// entra no lugar de parseCommand/applyCommand produzindo o mesmo Blueprint.

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
  const clientById = useCallback((id: string | null | undefined) => (id ? clients.find((client) => client.id === id) ?? null : null), [clients]);

  // cliente + conversa (indexada por id)
  const session = useStudioSession(clients);
  const activeId = session.activeClient;
  const activeClient = clientById(activeId);
  const messages = useMemo(() => (activeId ? session.threads[activeId] ?? [] : []), [session.threads, activeId]);

  // composer: texto + menção estruturada
  const [text, setText] = useState("");
  const [mention, setMention] = useState<ComposerMention | null>(null);
  const mentionClient = clientById(mention?.clientId);
  const inspectorClient = mentionClient ?? activeClient;
  const detected = Boolean(mentionClient && mentionClient.id !== activeId);

  // rascunho (sempre do cliente ATIVO)
  const [drafts, setDrafts] = useState<StudioDrafts>(freshDrafts);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = messages.find((message): message is RecipeMessage => message.id === openId && message.role === "assistant" && message.kind === "recipe") ?? null;

  // cache de contexto por cliente (à prova de resposta atrasada)
  const [cache, setCache] = useState<ContextCache<NorthAiClientContext>>({});
  const cacheRef = useRef(cache);
  useEffect(() => { cacheRef.current = cache; }, [cache]);
  const requestSeq = useRef(0);
  const controllers = useRef(new Map<string, AbortController>());

  const loadContext = useCallback(async (clientId: string, force = false) => {
    const existing = cacheRef.current[clientId];
    if (!force && existing && existing.status !== "error") return;
    const requestId = ++requestSeq.current;
    controllers.current.get(clientId)?.abort();
    const controller = new AbortController();
    controllers.current.set(clientId, controller);
    setCache((current) => cacheStart(current, clientId, requestId));
    try {
      const res = await fetch(`/api/admin/northai/context?clientId=${encodeURIComponent(clientId)}`, { signal: controller.signal });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "erro desconhecido");
      setCache((current) => cacheResolve(current, clientId, requestId, data as NorthAiClientContext));
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") return;
      setCache((current) => cacheFail(current, clientId, requestId, error instanceof Error ? error.message : "erro desconhecido"));
    }
  }, []);

  // Só busca quando um cliente é EFETIVAMENTE escolhido — nunca por tecla.
  useEffect(() => { if (activeId) void loadContext(activeId); }, [activeId, loadContext]);
  useEffect(() => { if (mentionClient) void loadContext(mentionClient.id); }, [mentionClient, loadContext]);

  const threadContext = activeId ? cache[activeId]?.data ?? null : null;
  const inspectorEntry = inspectorClient ? cache[inspectorClient.id] ?? null : null;

  // execução + gavetas
  const [busy, setBusy] = useState(false);
  const [drawer, setDrawer] = useState<"none" | "history" | "context">("none");
  const [switcher, setSwitcher] = useState<{ open: boolean; query: string; index: number }>({ open: false, query: "", index: 0 });
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, openId]);

  const built = useMemo(
    () => (open ? buildRecipe(open.recipe, drafts, { client: activeClient, deliveryTypes, routines: threadContext?.options.routines ?? [], today }) : { value: null, problem: null }),
    [open, drafts, activeClient, deliveryTypes, threadContext, today],
  );
  const sources = useMemo(() => (open ? recipeSources(open.recipe, drafts, { hasContext: Boolean(threadContext) }) : []), [open, drafts, threadContext]);

  /** Descarta o pedido em andamento — nunca o reaproveita em outro cliente. */
  const cancelOpen = useCallback((note: string) => {
    if (!activeId || !open || (open.status !== "rascunho" && open.status !== "revisar")) return;
    session.patch(activeId, open.id, { status: "cancelado", note });
    setOpenId(null);
  }, [activeId, open, session]);

  function changeClient(nextId: string | null) {
    if (nextId === activeId) return;
    cancelOpen("Rascunho descartado ao trocar de cliente — nada foi criado.");
    setOpenId(null);
    setDrafts(freshDrafts());
    session.setActiveClient(nextId);
    setDrawer("none");
  }

  function say(clientId: string, message: string, tone?: "info" | "warn" | "error") {
    session.append(clientId, { id: newId(), at: now(), role: "assistant", kind: "text", text: message, tone });
  }

  function startRecipe(target: ClientLite, recipe: RecipeKey, options: { askText?: string | null; understood?: string | null; nextDrafts?: StudioDrafts } = {}) {
    cancelOpen("Substituído por outro pedido.");
    if (options.askText !== null) session.append(target.id, { id: newId(), at: now(), role: "user", text: options.askText ?? RECIPE_META[recipe].ask, clientId: target.id });
    if (recipe === "analise") {
      const context = cache[target.id]?.data;
      if (!context) {
        say(target.id, "O contexto deste cliente ainda está carregando. Tente de novo em instantes.", "warn");
        void loadContext(target.id);
        return;
      }
      const op = context.operation;
      session.append(target.id, {
        id: newId(),
        at: now(),
        role: "assistant",
        kind: "analysis",
        percent: context.knowledge.percent,
        summary: `${RECIPE_META.analise.intro} ${op.abertas} tarefas abertas, ${op.atrasadas} atrasadas, ${op.paradas} paradas${op.proximaGravacao ? `, próxima gravação em ${op.proximaGravacao.date.slice(8, 10)}/${op.proximaGravacao.date.slice(5, 7)}` : ", sem gravação agendada"}.`,
        gaps: context.gaps.map((gap) => ({ title: gap.title, detail: gap.detail, severity: gap.severity })),
      });
      return;
    }
    setDrafts(options.nextDrafts ?? freshDrafts());
    say(target.id, options.understood ?? RECIPE_META[recipe].intro);
    const id = newId();
    session.append(target.id, { id, at: now(), role: "assistant", kind: "recipe", recipe, title: RECIPE_META[recipe].title, status: "rascunho", preview: [], result: null });
    setOpenId(id);
  }

  function pickRecipe(recipe: RecipeKey) {
    if (activeClient) startRecipe(activeClient, recipe);
  }

  function resolveGap(gap: NorthAiGap) {
    if (!inspectorClient || !gap.recipe) return;
    setDrawer("none");
    if (inspectorClient.id !== activeId) {
      changeClient(inspectorClient.id);
      setMention(null);
    }
    startRecipe(inspectorClient, gap.recipe, { askText: `Resolver: ${gap.title}`, nextDrafts: applyPrefill(freshDrafts(), gap.recipe, gap.prefill) });
  }

  async function importLink(target: ClientLite, url: string) {
    const noteId = newId();
    session.append(target.id, { id: noteId, at: now(), role: "assistant", kind: "text", text: "Copiando o arquivo para os arquivos do cliente…" });
    try {
      const res = await fetch("/api/admin/northai/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, slug: target.slug }) });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Não foi possível copiar o arquivo.");
      const scripts = (data.scripts ?? []) as ReturnType<typeof parseScripts>;
      session.patch(target.id, noteId, { text: `Copiei “${data.document?.fileName ?? "o arquivo"}” para ${String(data.folderPath).split("/").pop()}.` } as Partial<StudioMessage>);
      if (scripts.length) {
        const base = freshDrafts();
        startRecipe(target, "diaria", {
          askText: null,
          understood: `Separei ${scripts.length === 1 ? "1 roteiro" : `${scripts.length} roteiros`} do documento. Informe a data da gravação e confira os formatos.`,
          nextDrafts: { ...base, diaria: { ...base.diaria, docUrl: url, scriptsText: data.text ?? "", pieces: piecesFromScripts(scripts) } },
        });
      }
      void loadContext(target.id, true);
    } catch (error) {
      session.patch(target.id, noteId, { text: error instanceof Error ? error.message : "Não foi possível copiar o arquivo.", tone: "error" } as Partial<StudioMessage>);
    }
  }

  /** O pedido já com o cliente resolvido. */
  async function process(target: ClientLite, value: string, parsed: ParsedCommand) {
    if (parsed.links.length) {
      await importLink(target, parsed.links[0]);
      return;
    }
    const lines = value.split("\n").filter((line) => line.trim()).length;
    if ((lines >= 4 || value.length > 280) && (!parsed.intent || parsed.intent === "diaria")) {
      const scripts = parseScripts(value);
      const base = freshDrafts();
      startRecipe(target, "diaria", {
        askText: null,
        understood: `Separei ${scripts.length === 1 ? "1 roteiro" : `${scripts.length} roteiros`}. Informe a data da gravação e confira os formatos.`,
        nextDrafts: { ...base, diaria: { ...base.diaria, scriptsText: value, shootDate: parsed.dates[0] ?? "", pieces: piecesFromScripts(scripts) } },
      });
      return;
    }
    const applied = applyCommand(freshDrafts(), parsed, value);
    if (!applied.intent) {
      say(target.id, "Ainda não sei responder perguntas. Posso montar uma diária, um plano, uma rotina, entregas ou uma automação — ou analisar a operação.", "warn");
      return;
    }
    startRecipe(target, applied.intent, { askText: null, understood: applied.understood, nextDrafts: applied.drafts });
  }

  async function send() {
    const value = text.trim();
    if (!value || busy) return;
    const parsed = parseCommand(value, { clients, today });
    const textClient = parsed.clientSlug ? clients.find((client) => client.slug === parsed.clientSlug) ?? null : null;
    const resolved = resolveNorthAiContext({ mentionClientId: mention?.clientId, textClientId: textClient?.id, threadClientId: activeId, workspaceClientId: activeId });
    const target = clientById(resolved.clientId);
    if (!target) return;
    const sentMention = mention;
    setText("");
    setMention(null);
    if (target.id !== activeId) changeClient(target.id);
    session.append(target.id, { id: newId(), at: now(), role: "user", text: value, clientId: target.id, mentionLabel: sentMention?.label });

    if (resolved.conflict) {
      const other = clientById(resolved.conflict.textClientId)!;
      session.append(target.id, {
        id: newId(),
        at: now(),
        role: "assistant",
        kind: "choice",
        text: `Você mencionou @${target.name}, mas o texto cita ${other.name}. Em qual cliente devo preparar?`,
        options: [{ clientId: target.id, label: target.name }, { clientId: other.id, label: other.name }],
        pendingText: value,
        chosenClientId: null,
      });
      return;
    }
    await process(target, value, parsed);
  }

  async function resolveChoice(message: ChoiceMessage, clientId: string) {
    const chosen = clientById(clientId);
    if (!chosen || !activeId) return;
    session.patch(activeId, message.id, { chosenClientId: clientId } as Partial<StudioMessage>);
    if (chosen.id !== activeId) changeClient(chosen.id);
    await process(chosen, message.pendingText, parseCommand(message.pendingText, { clients, today }));
  }

  function review() {
    if (activeId && open && built.value) session.patch(activeId, open.id, { status: "revisar" });
  }

  function edit() {
    if (activeId && open) session.patch(activeId, open.id, { status: "rascunho" });
  }

  async function confirm() {
    if (!activeId || !open || !built.value || busy) return;
    const { blueprint, preview } = built.value;
    const messageId = open.id;
    const recipe = open.recipe;
    const clientId = activeId;
    setBusy(true);
    session.patch(clientId, messageId, { status: "criando", preview });
    let result: BlueprintResult;
    try {
      const res = await fetch("/api/admin/northai/execute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ blueprint }) });
      const data = await res.json().catch(() => null);
      result = { created: Array.isArray(data?.created) ? data.created : [], error: res.ok ? null : data?.error ?? "Não foi possível criar." };
    } catch {
      result = { created: [], error: "Falha de rede ao criar." };
    }
    const failedClean = Boolean(result.error) && !result.created.length;
    session.patch(clientId, messageId, { status: result.error ? "erro" : "criado", result, title: result.error ? RECIPE_META[recipe].title : RECIPE_META[recipe].done });
    if (!failedClean) setOpenId(null);
    setBusy(false);
    void loadContext(clientId, true);
  }

  function restart() {
    setOpenId(null);
    setDrafts(freshDrafts());
  }

  const turns = useMemo(() => groupTurns(messages), [messages]);
  const recipeOpen = Boolean(open && (open.status === "rascunho" || open.status === "revisar" || open.status === "criando" || open.status === "erro"));
  const switcherOptions = useMemo(() => filterClients(clients, switcher.query, 8), [clients, switcher.query]);

  function renderAssistant(message: Extract<StudioMessage, { role: "assistant" }>) {
    if (message.kind === "text") return <p key={message.id} className={`nai-say${message.tone ? ` tone-${message.tone}` : ""}`}>{message.text}</p>;
    if (message.kind === "choice") {
      return (
        <div key={message.id} className="nai-choice">
          <p className="nai-say tone-warn">{message.text}</p>
          <div className="nai-choice-actions">
            {message.options.map((option) => (
              <button
                type="button"
                key={option.clientId}
                className={`nai-suggestion${message.chosenClientId === option.clientId ? " is-on" : ""}`}
                disabled={Boolean(message.chosenClientId)}
                onClick={() => void resolveChoice(message, option.clientId)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      );
    }
    if (message.kind === "analysis") {
      return (
        <section key={message.id} className="nai-op">
          <header className="nai-op-head"><span className="nai-op-kicker">Análise da operação</span></header>
          <p className="nai-say">{message.summary}</p>
          {message.gaps.length ? (
            <ul className="nai-analysis">
              {message.gaps.map((gap, index) => <li key={index} className={`sev-${gap.severity}`}><b>{gap.title}</b> — {gap.detail}</li>)}
            </ul>
          ) : <p className="nai-muted">Nada pendente — o cliente está amarrado.</p>}
          <p className="nai-muted">Use “Resolver” no contexto para começar por uma lacuna.</p>
        </section>
      );
    }
    return (
      <OperationCard
        key={message.id}
        message={message}
        isOpen={message.id === openId}
        busy={busy}
        drafts={drafts}
        onDrafts={(update) => setDrafts(update)}
        built={built}
        sources={sources}
        assignees={assignees}
        shootTypes={shootTypes}
        deliveryTypes={deliveryTypes}
        plans={threadContext?.options.plans ?? []}
        routines={threadContext?.options.routines ?? []}
        onDiscard={() => cancelOpen("Cancelado — nada foi criado.")}
        onReview={review}
        onEdit={edit}
        onConfirm={() => void confirm()}
        onRestart={restart}
      />
    );
  }

  return (
    <div className={`nai-studio${drawer !== "none" ? " has-drawer" : ""}`}>
      <div className="nai-col">
        <div className="nai-scroll" ref={scrollRef}>
          <div className="nai-scroll-inner">
            <header className="nai-header">
              <NorthAiTabs />
              {activeClient ? (
                <div className="nai-workspace">
                  <ClientIdentity
                    client={activeClient}
                    label="Contexto ativo"
                    action={
                      <div className="nai-switch">
                        <button type="button" className="nai-switch-btn" aria-expanded={switcher.open} onClick={() => setSwitcher((current) => ({ open: !current.open, query: "", index: 0 }))}>
                          Trocar
                        </button>
                        {switcher.open ? (
                          <div className="nai-switch-pop">
                            <input
                              autoFocus
                              className="nai-switch-search"
                              value={switcher.query}
                              placeholder="Buscar cliente…"
                              aria-label="Buscar cliente"
                              onChange={(event) => setSwitcher({ open: true, query: event.target.value, index: 0 })}
                              onKeyDown={(event) => {
                                if (event.key === "Escape") setSwitcher({ open: false, query: "", index: 0 });
                                if (event.key === "ArrowDown") { event.preventDefault(); setSwitcher((current) => ({ ...current, index: (current.index + 1) % Math.max(1, switcherOptions.length) })); }
                                if (event.key === "ArrowUp") { event.preventDefault(); setSwitcher((current) => ({ ...current, index: (current.index - 1 + switcherOptions.length) % Math.max(1, switcherOptions.length) })); }
                                if (event.key === "Enter" && switcherOptions[switcher.index]) { event.preventDefault(); changeClient(switcherOptions[switcher.index].id); setSwitcher({ open: false, query: "", index: 0 }); }
                              }}
                              onBlur={() => setTimeout(() => setSwitcher({ open: false, query: "", index: 0 }), 120)}
                            />
                            <ClientMentionPicker
                              id="nai-switch-list"
                              clients={switcherOptions}
                              activeIndex={switcher.index}
                              placement="down"
                              onPick={(client) => { changeClient(client.id); setSwitcher({ open: false, query: "", index: 0 }); }}
                              onHover={(index) => setSwitcher((current) => ({ ...current, index }))}
                            />
                          </div>
                        ) : null}
                      </div>
                    }
                  />
                </div>
              ) : null}
            </header>

            <div className="nai-thread" aria-live="polite">
              {!activeClient ? (
                <AssistantTurn client={null}>
                  <p className="nai-say">Em qual cliente vamos trabalhar? Digite <b>@</b> na caixa abaixo ou escolha:</p>
                  <div className="nai-choice-actions">
                    {[...clients].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 8).map((client) => (
                      <button type="button" key={client.id} className="nai-suggestion" onClick={() => changeClient(client.id)}>{client.name}</button>
                    ))}
                  </div>
                </AssistantTurn>
              ) : !messages.length ? (
                <AssistantTurn client={activeClient}>
                  <p className="nai-say">O que vamos construir? Cole os roteiros, o link do Docs ou escreva o pedido — eu mostro tudo antes de criar.</p>
                  <div className="nai-actions">
                    {RECIPE_ORDER.map((key) => (
                      <button type="button" key={key} className="nai-action" onClick={() => pickRecipe(key)}>
                        <strong>{RECIPE_META[key].title}</strong>
                        <span>{RECIPE_META[key].blurb}</span>
                      </button>
                    ))}
                  </div>
                </AssistantTurn>
              ) : null}

              {activeClient ? turns.map((turn) =>
                turn.role === "user" ? (
                  <UserTurn key={turn.key} text={turn.message.text} mentionLabel={turn.message.mentionLabel} />
                ) : (
                  <AssistantTurn key={turn.key} client={activeClient}>
                    {turn.messages.map(renderAssistant)}
                  </AssistantTurn>
                ),
              ) : null}
            </div>
          </div>
        </div>

        <StudioComposer
          clients={clients}
          text={text}
          mention={mention}
          onText={setText}
          onMention={setMention}
          onSend={() => void send()}
          onPick={pickRecipe}
          showSuggestions={Boolean(activeClient) && messages.length > 0 && !recipeOpen}
          placeholderClient={inspectorClient?.name ?? null}
          disabled={busy}
          onOpenHistory={() => setDrawer((current) => (current === "history" ? "none" : "history"))}
          onOpenContext={() => setDrawer((current) => (current === "context" ? "none" : "context"))}
        />
      </div>

      <aside className={`nai-side${drawer === "context" ? " is-open" : ""}`} aria-label="Contexto do cliente">
        <ContextInspector
          client={inspectorClient}
          detected={detected}
          context={inspectorEntry?.data ?? null}
          status={inspectorEntry?.status ?? "idle"}
          error={inspectorEntry?.error ?? null}
          focusRecipe={!detected && open ? open.recipe : null}
          onResolve={resolveGap}
          onReload={() => { if (inspectorClient) void loadContext(inspectorClient.id, true); }}
          onClose={drawer === "context" ? () => setDrawer("none") : undefined}
        />
      </aside>

      {drawer === "history" ? (
        <aside className="nai-drawer is-left" aria-label="Conversas recentes">
          <SessionHistory clients={clients} threads={session.threads} activeClient={activeId} onPick={(next) => changeClient(next)} onClose={() => setDrawer("none")} />
        </aside>
      ) : null}
      {drawer !== "none" ? <button type="button" className="nai-backdrop" aria-label="Fechar" onClick={() => setDrawer("none")} /> : null}
    </div>
  );
}
