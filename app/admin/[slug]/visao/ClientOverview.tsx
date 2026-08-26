import type { ReactNode } from "react";
import type { AdminClientDetail } from "@/lib/supabase";
import { kindLabel } from "@/lib/taskCatalog";
import type { TaskStatus } from "@/lib/validation";
import DriveFolderPreviews from "./DriveFolderPreviews";

type Checkpoint = { id: string; title: string; status: TaskStatus; done: boolean; dueDate: string | null };
type Plan = { id: string; title: string; progress: number; activities: number; status: TaskStatus };
type OpenTask = { id: string; title: string; status: TaskStatus; kind: string; progress: number };

const PLANO_LABEL: Record<string, string> = { start: "Start", growth: "Growth", custom: "Custom" };

function brl(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function date(iso: string | null): string {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("pt-BR");
}

export default function ClientOverview({
  detail,
  checkpoints,
  plans,
  openTasks,
  instagram,
}: {
  detail: AdminClientDetail;
  checkpoints: Checkpoint[];
  plans: Plan[];
  openTasks: OpenTask[];
  instagram: ReactNode;
}) {
  const done = checkpoints.filter((c) => c.done).length;

  return (
    <>
      <div className="admin-chiprow visao-chips">
        {detail.companyInfo.segmento ? <span className="admin-pill muted">{detail.companyInfo.segmento}</span> : null}
        {detail.contract.planoTier ? (
          <span className="admin-pill on">Plano {PLANO_LABEL[detail.contract.planoTier] ?? detail.contract.planoTier}</span>
        ) : null}
        {detail.contract.contractStart ? (
          <span className="admin-pill muted">Desde {date(detail.contract.contractStart)}</span>
        ) : null}
        {detail.contract.valorMensal != null ? (
          <span className="admin-pill muted">{brl(detail.contract.valorMensal)} / mês</span>
        ) : null}
        <span className={`admin-pill ${detail.is_active ? "on" : "off"}`}>
          {detail.is_active ? "Ativo" : "Inativo"}
        </span>
        {detail.contract.responsavelNome ? (
          <span className="admin-pill muted">
            {detail.contract.responsavelNome}
            {detail.contract.responsavelWhatsapp ? ` · ${detail.contract.responsavelWhatsapp}` : ""}
          </span>
        ) : null}
      </div>

      <div className="visao-cols">
        <div className="visao-main">{instagram}</div>

        <div className="visao-side">
          <div className="admin-card">
            <p className="admin-card-title">Resultados declarados</p>
            {detail.results.topMetrics.length === 0 ? (
              <p className="admin-hint">Nenhuma métrica cadastrada em Editar cliente › Resultados.</p>
            ) : (
              <ul className="visao-kv">
                {detail.results.topMetrics.map((m) => (
                  <li key={m.label}>
                    <span>{m.label}</span>
                    <strong>
                      {m.value}
                      {m.variation ? <em className="visao-delta">{m.variation}</em> : null}
                    </strong>
                  </li>
                ))}
              </ul>
            )}
            {detail.results.reportUrl ? (
              <a className="admin-btn ghost" href={detail.results.reportUrl} target="_blank" rel="noreferrer">
                Ver relatório ↗
              </a>
            ) : null}
          </div>

          <div className="admin-card">
            <div className="home-card-head">
              <p className="admin-card-title">Checkpoints comerciais</p>
              <span className="admin-pill muted">
                {done} de {checkpoints.length}
              </span>
            </div>
            {checkpoints.length === 0 ? (
              <p className="admin-hint">Nenhum checkpoint provisionado.</p>
            ) : (
              <ul className="visao-timeline">
                {checkpoints.map((c) => (
                  <li key={c.id}>
                    <div className="home-list-main">
                      <strong>{c.title}</strong>
                      <span className="admin-hint">{date(c.dueDate)}</span>
                    </div>
                    <span className={`admin-pill ${c.done ? "on" : "muted"}`}>{c.done ? "Concluído" : "Pendente"}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="visao-cols">
        <div className="admin-card">
          <div className="home-card-head">
            <p className="admin-card-title">Plano de ação</p>
            <span className="admin-pill muted">{plans.length}</span>
          </div>
          {plans.length === 0 ? (
            <p className="admin-hint">Nenhum plano de ação para este cliente.</p>
          ) : (
            <ul className="home-list">
              {plans.map((p) => (
                <li key={p.id}>
                  <div className="home-list-main">
                    <strong>{p.title}</strong>
                    <span className="visao-bar" aria-hidden="true">
                      <span style={{ width: `${Math.min(100, Math.max(0, p.progress))}%` }} />
                    </span>
                    <span className="admin-hint">{p.activities} atividades</span>
                  </div>
                  <strong className="visao-pct">{p.progress}%</strong>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="admin-card">
          <div className="home-card-head">
            <p className="admin-card-title">Tarefas em andamento</p>
            <span className="admin-pill muted">{openTasks.length}</span>
          </div>
          {openTasks.length === 0 ? (
            <p className="admin-hint">Nada em aberto.</p>
          ) : (
            <ul className="home-list">
              {openTasks.map((t) => (
                <li key={t.id}>
                  <div className="home-list-main">
                    <strong>{t.title}</strong>
                    <span className="admin-hint">{kindLabel(t.kind)}</span>
                  </div>
                  <strong className="visao-pct">{t.progress}%</strong>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <DriveFolderPreviews folders={detail.driveFolders} links={detail.driveLinks} />
    </>
  );
}
