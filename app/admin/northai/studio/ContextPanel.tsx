"use client";

import Link from "next/link";
import type { NorthAiClientContext, NorthAiGap } from "@/lib/northai/context";
import { shortDate } from "@/lib/northai/recipes";

// O que o NorthAi sabe do cliente, a operação hoje e o que falta amarrar.
export default function ContextPanel({
  clientName,
  context,
  loading,
  error,
  onResolve,
  onReload,
  onClose,
}: {
  clientName: string | null;
  context: NorthAiClientContext | null;
  loading: boolean;
  error: string;
  onResolve: (gap: NorthAiGap) => void;
  onReload: () => void;
  onClose?: () => void;
}) {
  return (
    <div className="nai-context">
      <div className="nai-context-head">
        <strong>{clientName ?? "Contexto"}</strong>
        {onClose ? <button type="button" className="kb-modal-close" onClick={onClose} aria-label="Fechar contexto">✕</button> : null}
      </div>

      {!clientName ? (
        <p className="nai-muted">Escolha um cliente para ver o que já está amarrado e o que falta.</p>
      ) : error ? (
        <div className="nai-card">
          <p className="admin-error">Não foi possível carregar o contexto: {error}</p>
          <button type="button" className="admin-btn ghost" onClick={onReload}>Tentar de novo</button>
        </div>
      ) : !context || loading ? (
        <p className="nai-muted">Carregando…</p>
      ) : (
        <>
          <section className="nai-card">
            <div className="nai-card-head">
              <span className="nai-card-title">Cadastro conectado</span>
              <b className="nai-percent">{context.knowledge.percent}%</b>
            </div>
            <div className="nai-bar" role="progressbar" aria-valuenow={context.knowledge.percent} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${context.knowledge.percent}%` }} />
            </div>
            <ul className="nai-checks">
              {context.knowledge.checks.map((check) => (
                <li key={check.key} className={check.ok ? "ok" : ""}><span aria-hidden>{check.ok ? "✓" : "○"}</span>{check.label}</li>
              ))}
            </ul>
          </section>

          <section className="nai-card">
            <span className="nai-card-title">Operação hoje</span>
            <dl className="nai-ops">
              <div><dt>Tarefas abertas</dt><dd>{context.operation.abertas}</dd></div>
              <div><dt>Atrasadas</dt><dd className={context.operation.atrasadas ? "t-red" : ""}>{context.operation.atrasadas}</dd></div>
              <div><dt>Paradas</dt><dd>{context.operation.paradas}</dd></div>
              <div><dt>Vencem na semana</dt><dd>{context.operation.semana}</dd></div>
              <div><dt>Rotinas ativas</dt><dd>{context.operation.rotinasAtivas}</dd></div>
              <div><dt>Automações ativas</dt><dd>{context.operation.automacoesAtivas}</dd></div>
            </dl>
            <p className="nai-ops-line">
              <span>Plano ativo</span>
              {context.operation.planoAtivo ? <Link href={`/admin/kanban?task=${context.operation.planoAtivo.id}`}>{context.operation.planoAtivo.title}</Link> : <em>nenhum</em>}
            </p>
            <p className="nai-ops-line">
              <span>Próxima gravação</span>
              {context.operation.proximaGravacao ? (
                <Link href={`/admin/kanban?task=${context.operation.proximaGravacao.id}`}>{shortDate(context.operation.proximaGravacao.date)}</Link>
              ) : <em>não agendada</em>}
            </p>
          </section>

          <section className="nai-card">
            <span className="nai-card-title">O que falta amarrar</span>
            {context.gaps.length ? (
              <ul className="nai-gaps">
                {context.gaps.slice(0, 6).map((gap) => (
                  <li key={gap.key} className={`sev-${gap.severity}`}>
                    <div>
                      <strong>{gap.title}</strong>
                      <span>{gap.detail}</span>
                      {gap.tasks.length ? (
                        <span className="nai-gap-links">
                          {gap.tasks.slice(0, 2).map((task) => <Link key={task.id} href={`/admin/kanban?task=${task.id}`}>{task.title || "abrir"}</Link>)}
                        </span>
                      ) : null}
                    </div>
                    {gap.recipe ? <button type="button" className="admin-btn ghost" onClick={() => onResolve(gap)}>Resolver</button> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="nai-muted">Nada pendente.</p>
            )}
          </section>

          <section className="nai-card">
            <span className="nai-card-title">Arquivos do cliente</span>
            <p className="nai-muted">
              {context.files.areas.map((area) => area.label).join(" · ")}
              <br />
              {context.files.location === "drive" ? "Google Drive da plataforma" : "Armazenamento interno — aparecem em Informações"}
            </p>
          </section>

          <button type="button" className="nai-link" onClick={onReload}>Atualizar contexto</button>
        </>
      )}
    </div>
  );
}
