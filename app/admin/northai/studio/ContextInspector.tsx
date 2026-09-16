"use client";

import Link from "next/link";
import type { NorthAiClientContext, NorthAiGap } from "@/lib/northai/context";
import type { RecipeKey } from "@/lib/northai/commandParser";
import { shortDate } from "@/lib/northai/recipes";
import ClientIdentity from "./ClientIdentity";
import type { ClientLite } from "./types";

// O inspetor de contexto: a janela para o que o NorthAi está usando. Muda de
// cliente assim que uma @menção é escolhida (antes de enviar) e destaca o que
// importa para o pedido aberto. Nada aqui é inventado: é o contexto carregado.

type FocusSection = { title: string; rows: { label: string; value: React.ReactNode }[]; gapKeys: string[] };

function focusFor(recipe: RecipeKey | null, context: NorthAiClientContext): FocusSection | null {
  const op = context.operation;
  const gapKeys = (keys: string[]) => keys.filter((key) => context.gaps.some((gap) => gap.key === key));
  switch (recipe) {
    case "diaria":
      return {
        title: "Para esta diária",
        rows: [
          { label: "Próxima gravação", value: op.proximaGravacao ? shortDate(op.proximaGravacao.date) : "não agendada" },
          { label: "Roteiros", value: "arquivos do cliente · Roteiros" },
        ],
        gapKeys: gapKeys(["sem-formato"]),
      };
    case "automacao":
      return {
        title: "Para esta automação",
        rows: [
          { label: "Automações ativas", value: op.automacoesAtivas },
          { label: "Rotinas que podem receber", value: context.options.routines.length ? context.options.routines.map((routine) => routine.title).slice(0, 3).join(", ") : "nenhuma — crie uma rotina nova" },
        ],
        gapKeys: gapKeys(["sem-automacao"]),
      };
    case "rotina":
      return { title: "Para esta rotina", rows: [{ label: "Rotinas ativas", value: op.rotinasAtivas }], gapKeys: gapKeys(["rotinas"]) };
    case "plano":
      return { title: "Para este plano", rows: [{ label: "Plano ativo", value: op.planoAtivo?.title ?? "nenhum" }], gapKeys: gapKeys(["sem-plano"]) };
    case "fluxo":
      return { title: "Para estas entregas", rows: [{ label: "Plano ativo", value: op.planoAtivo?.title ?? "nenhum" }], gapKeys: gapKeys(["sem-formato"]) };
    default:
      return null;
  }
}

export default function ContextInspector({
  client,
  detected,
  context,
  status,
  error,
  focusRecipe,
  onResolve,
  onReload,
  onClose,
}: {
  client: ClientLite | null;
  /** O contexto veio de uma @menção ainda não enviada. */
  detected: boolean;
  context: NorthAiClientContext | null;
  status: "loading" | "ready" | "error" | "idle";
  error: string | null;
  focusRecipe: RecipeKey | null;
  onResolve: (gap: NorthAiGap) => void;
  onReload: () => void;
  onClose?: () => void;
}) {
  if (!client) {
    return (
      <div className="nai-inspector">
        <div className="nai-inspector-top">
          <span className="nai-section-label">Contexto</span>
          {onClose ? <button type="button" className="kb-modal-close" onClick={onClose} aria-label="Fechar contexto">✕</button> : null}
        </div>
        <p className="nai-muted">Mencione um cliente com @ para o NorthAi carregar o contexto dele.</p>
      </div>
    );
  }

  const ready = context && context.identity.id === client.id ? context : null;
  const focus = ready ? focusFor(focusRecipe, ready) : null;
  const known = ready?.knowledge.checks.filter((check) => check.ok) ?? [];
  const missing = ready?.knowledge.checks.filter((check) => !check.ok) ?? [];
  const attention = ready ? [...ready.gaps].sort((a, b) => ["alta", "media", "baixa"].indexOf(a.severity) - ["alta", "media", "baixa"].indexOf(b.severity)).slice(0, 4) : [];

  return (
    <div className={`nai-inspector${detected ? " is-detected" : ""}`}>
      <div className="nai-inspector-top">
        <span className="nai-section-label">{detected ? "Contexto detectado" : "Contexto"}</span>
        {onClose ? <button type="button" className="kb-modal-close" onClick={onClose} aria-label="Fechar contexto">✕</button> : null}
      </div>
      <ClientIdentity client={client} label={detected ? "Pedido irá para" : "NorthAi opera em"} />

      {status === "error" && !ready ? (
        <div className="nai-panel">
          <p className="admin-error">Não foi possível carregar o contexto: {error}</p>
          <button type="button" className="admin-btn ghost" onClick={onReload}>Tentar de novo</button>
        </div>
      ) : !ready ? (
        <p className="nai-muted" role="status">Carregando o contexto…</p>
      ) : (
        <>
          <section className="nai-panel">
            <div className="nai-panel-head">
              <span className="nai-section-label">Cadastro conectado</span>
              <b className="nai-percent">{ready.knowledge.percent}%</b>
            </div>
            <div className="nai-bar" role="progressbar" aria-label="Cadastro conectado" aria-valuenow={ready.knowledge.percent} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${ready.knowledge.percent}%` }} />
            </div>
            {known.length ? (
              <div className="nai-knows">
                <span className="nai-knows-label">O NorthAi conhece</span>
                <ul>{known.map((check) => <li key={check.key}><span aria-hidden>✓</span>{check.label}</li>)}</ul>
              </div>
            ) : null}
            {missing.length ? (
              <div className="nai-knows is-missing">
                <span className="nai-knows-label">Falta conectar</span>
                <ul>{missing.map((check) => <li key={check.key}><span aria-hidden>!</span>{check.label}</li>)}</ul>
              </div>
            ) : null}
          </section>

          {focus ? (
            <section className="nai-panel is-focus">
              <span className="nai-section-label">{focus.title}</span>
              <dl className="nai-rows">
                {focus.rows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}
              </dl>
              {focus.gapKeys.map((key) => {
                const gap = ready.gaps.find((entry) => entry.key === key)!;
                return (
                  <p className="nai-focus-gap" key={key}>
                    <b>{gap.title}</b> {gap.detail}
                  </p>
                );
              })}
            </section>
          ) : null}

          <section className="nai-panel">
            <span className="nai-section-label">Operação</span>
            <div className="nai-headline-figures">
              <div className={ready.operation.atrasadas ? "is-alert" : ""}><strong>{ready.operation.atrasadas}</strong><span>atrasadas</span></div>
              <div className={ready.operation.paradas ? "is-alert" : ""}><strong>{ready.operation.paradas}</strong><span>paradas</span></div>
              <div><strong>{ready.operation.semana}</strong><span>vencem na semana</span></div>
            </div>
            <dl className="nai-rows">
              <div><dt>Tarefas abertas</dt><dd>{ready.operation.abertas}</dd></div>
              <div><dt>Rotinas · automações</dt><dd>{ready.operation.rotinasAtivas} · {ready.operation.automacoesAtivas}</dd></div>
              <div><dt>Plano ativo</dt><dd>{ready.operation.planoAtivo ? <Link href={`/admin/operacao?task=${ready.operation.planoAtivo.id}`}>{ready.operation.planoAtivo.title}</Link> : "nenhum"}</dd></div>
              <div><dt>Próxima gravação</dt><dd>{ready.operation.proximaGravacao ? <Link href={`/admin/operacao?task=${ready.operation.proximaGravacao.id}`}>{shortDate(ready.operation.proximaGravacao.date)}</Link> : "não agendada"}</dd></div>
            </dl>
          </section>

          {attention.length ? (
            <section className="nai-panel">
              <span className="nai-section-label">Precisa de atenção</span>
              <ul className="nai-attention">
                {attention.map((gap) => (
                  <li key={gap.key} className={`sev-${gap.severity}`}>
                    <div>
                      <strong><span className="nai-sev" aria-label={gap.severity === "alta" ? "Alta" : gap.severity === "media" ? "Média" : "Baixa"}>{gap.severity === "alta" ? "!!" : gap.severity === "media" ? "!" : "·"}</span> {gap.title}</strong>
                      <span>{gap.detail}</span>
                      {gap.tasks.length ? (
                        <span className="nai-attention-links">
                          {gap.tasks.slice(0, 2).map((task) => <Link key={task.id} href={`/admin/operacao?task=${task.id}`}>{task.title || "abrir"}</Link>)}
                        </span>
                      ) : null}
                    </div>
                    {gap.recipe ? <button type="button" className="nai-resolve" onClick={() => onResolve(gap)}>Resolver</button> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="nai-panel">
            <span className="nai-section-label">Arquivos do cliente</span>
            <p className="nai-files">{ready.files.areas.map((area) => area.label).join(" · ")}</p>
            <p className="nai-muted">{ready.files.location === "drive" ? "Google Drive da plataforma" : "Armazenamento interno · aparecem em Informações"}</p>
          </section>

          <button type="button" className="nai-link-btn" onClick={onReload}>{status === "loading" ? "Atualizando…" : "Atualizar contexto"}</button>
        </>
      )}
    </div>
  );
}
