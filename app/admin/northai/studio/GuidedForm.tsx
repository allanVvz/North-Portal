"use client";

import { AUTOMATION_DEFINITIONS, AUTOMATION_KEYS } from "@/lib/automationCatalog";
import type { Cadence } from "@/lib/northai/commandParser";
import { NORTH_FORMATS, type NorthFormatKey } from "@/lib/northai/formats";
import { defaultPublishDate } from "@/lib/northai/recipes";
import { parseScripts } from "@/lib/northai/scriptParser";
import { piecesFromScripts, type FormRecipe, type StudioDrafts } from "@/lib/northai/drafts";
import ComboField, { type ComboOption } from "./ComboField";
import type { TypeLite } from "./types";

// Os campos de cada receita. Só desenha e devolve mudanças do rascunho — o que
// vai ser criado é decidido em lib/northai/drafts.ts.

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const FORMAT_OPTIONS: ComboOption[] = NORTH_FORMATS.map((format) => ({ value: format.key, label: format.label }));
const REPEAT_OPTIONS: ComboOption[] = [
  { value: "semanal", label: "Toda semana" },
  { value: "quinzenal", label: "A cada 15 dias" },
  { value: "mensal", label: "Todo mês" },
];

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

export default function GuidedForm({
  recipe,
  drafts,
  onDrafts,
  assignees,
  shootTypes,
  deliveryTypes,
  plans,
  routines,
}: {
  recipe: FormRecipe;
  drafts: StudioDrafts;
  onDrafts: (update: (current: StudioDrafts) => StudioDrafts) => void;
  assignees: readonly string[];
  shootTypes: readonly TypeLite[];
  deliveryTypes: readonly TypeLite[];
  plans: readonly { id: string; title: string }[];
  routines: readonly { id: string; title: string }[];
}) {
  const assigneeOptions: ComboOption[] = assignees.map((name) => ({ value: name, label: name }));

  if (recipe === "diaria") {
    const d = drafts.diaria;
    const set = (patch: Partial<typeof d>) => onDrafts((current) => ({ ...current, diaria: { ...current.diaria, ...patch } }));
    const setPiece = (index: number, patch: Partial<(typeof d.pieces)[number]>) =>
      set({ pieces: d.pieces.map((piece, i) => (i === index ? { ...piece, ...patch } : piece)) });
    return (
      <div className="nai-form">
        <div className="nai-fields">
          <label className="nai-date"><span>Gravação</span>
            <input type="date" value={d.shootDate} onChange={(event) => set({ shootDate: event.target.value })} />
          </label>
          <ComboField label="Responsável" value={d.assignee} options={assigneeOptions} emptyLabel="Sem responsável" onChange={(assignee) => set({ assignee })} />
          {shootTypes.length > 1 ? (
            <ComboField label="Tipo" value={d.typeKey} options={shootTypes.map((type) => ({ value: type.key, label: type.label }))} onChange={(typeKey) => set({ typeKey })} />
          ) : null}
          <ComboField
            label="Agrupar"
            value={d.withPlan ? "sim" : "nao"}
            options={[{ value: "sim", label: "Num plano da diária" }, { value: "nao", label: "Sem plano" }]}
            onChange={(value) => set({ withPlan: value === "sim" })}
          />
        </div>

        <p className="nai-label">Peças — o mesmo roteiro e a mesma gravação; edição e publicação próprias</p>
        <div className="nai-pieces">
          {d.pieces.map((piece, index) => (
            <div className="nai-piece" key={index}>
              <span className="nai-piece-n">{index + 1}</span>
              <input className="nai-piece-title" aria-label={`Título da peça ${index + 1}`} value={piece.title} onChange={(event) => setPiece(index, { title: event.target.value })} />
              <ComboField label="Formato" size="sm" value={piece.format} options={FORMAT_OPTIONS} onChange={(format) => setPiece(index, { format: format as NorthFormatKey })} />
              <label className="nai-date is-compact"><span>Publica</span>
                <input
                  type="date"
                  value={piece.publishDate ?? (d.shootDate ? defaultPublishDate(d.shootDate, index) : "")}
                  onChange={(event) => setPiece(index, { publishDate: event.target.value || null })}
                />
              </label>
              <button type="button" className="tm-member-unlink" aria-label={`Remover peça ${index + 1}`} onClick={() => set({ pieces: d.pieces.filter((_, i) => i !== index) })}>✕</button>
            </div>
          ))}
          <div className="nai-add">
            {NORTH_FORMATS.map((format) => (
              <button
                type="button"
                key={format.key}
                className="kb-chip"
                onClick={() => set({ pieces: [...d.pieces, { title: `${format.label} ${d.pieces.filter((piece) => piece.format === format.key).length + 1}`, format: format.key, publishDate: null, body: "" }] })}
              >
                + {format.label}
              </button>
            ))}
          </div>
        </div>

        <details className="nai-scripts" open={!d.pieces.length && Boolean(d.scriptsText)}>
          <summary>Roteiros colados{d.docUrl ? " · documento copiado para os arquivos do cliente" : ""}</summary>
          <textarea rows={5} value={d.scriptsText} onChange={(event) => set({ scriptsText: event.target.value })} placeholder="Cole o texto dos roteiros. Títulos como “Roteiro 1 — Reels” separam as peças." />
          <button type="button" className="admin-btn ghost" disabled={!d.scriptsText.trim()} onClick={() => set({ pieces: piecesFromScripts(parseScripts(d.scriptsText)) })}>
            Separar em peças
          </button>
        </details>
      </div>
    );
  }

  if (recipe === "plano") {
    const d = drafts.plano;
    const set = (patch: Partial<typeof d>) => onDrafts((current) => ({ ...current, plano: { ...current.plano, ...patch } }));
    return (
      <div className="nai-form">
        <label className="nai-text"><span>Nome do plano</span>
          <input value={d.title} onChange={(event) => set({ title: event.target.value })} placeholder="Plano de conteúdo — outubro" />
        </label>
        <div className="nai-fields">
          <label className="nai-date"><span>Começa</span>
            <input type="date" value={d.startDate} onChange={(event) => set({ startDate: event.target.value })} />
          </label>
          <ComboField label="Responsável" value={d.assignee} options={assigneeOptions} emptyLabel="Sem responsável" onChange={(assignee) => set({ assignee })} />
        </div>
        <p className="nai-label">Volume de conteúdo</p>
        <div className="pac-panel nai-qty">
          {NORTH_FORMATS.map((format) => (
            <QtyField key={format.key} label={format.plural} value={d.counts[format.key] ?? 0} onChange={(next) => set({ counts: { ...d.counts, [format.key]: next } })} />
          ))}
        </div>
        <label className="nai-text"><span>Outras atividades (uma por linha)</span>
          <textarea rows={2} value={d.extra} onChange={(event) => set({ extra: event.target.value })} placeholder={"Ajustar bio do Instagram\nCriar Google Empresa"} />
        </label>
      </div>
    );
  }

  if (recipe === "rotina") {
    const d = drafts.rotina;
    const set = (patch: Partial<typeof d>) => onDrafts((current) => ({ ...current, rotina: { ...current.rotina, ...patch } }));
    return (
      <div className="nai-form">
        <label className="nai-text"><span>Nome</span>
          <input value={d.title} onChange={(event) => set({ title: event.target.value })} placeholder="Acompanhamento semanal" />
        </label>
        <div className="nai-fields">
          <ComboField label="Repete" value={d.cadence} options={REPEAT_OPTIONS} emptyLabel="Uma vez" onChange={(cadence) => set({ cadence: cadence as Cadence | "" })} />
          <label className="nai-date"><span>{d.cadence ? "Primeira data" : "Data"}</span>
            <input type="date" value={d.startDate} onChange={(event) => set({ startDate: event.target.value })} />
          </label>
          <ComboField label="Responsável" value={d.assignee} options={assigneeOptions} emptyLabel="Sem responsável" onChange={(assignee) => set({ assignee })} />
        </div>
        {d.cadence === "semanal" || d.cadence === "quinzenal" ? (
          <div className="nai-add" role="group" aria-label="Dias da semana">
            {WEEKDAYS.map((label, day) => (
              <button
                type="button"
                key={label}
                className={`kb-chip${d.weekdays.includes(day) ? " on" : ""}`}
                aria-pressed={d.weekdays.includes(day)}
                onClick={() => set({ weekdays: d.weekdays.includes(day) ? d.weekdays.filter((value) => value !== day) : [...d.weekdays, day].sort() })}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
        <label className="nai-text"><span>Descrição</span>
          <textarea rows={2} value={d.description} onChange={(event) => set({ description: event.target.value })} />
        </label>
      </div>
    );
  }

  if (recipe === "fluxo") {
    const d = drafts.fluxo;
    const set = (patch: Partial<typeof d>) => onDrafts((current) => ({ ...current, fluxo: { ...current.fluxo, ...patch } }));
    return (
      <div className="nai-form">
        <label className="nai-text"><span>Título</span>
          <input value={d.title} onChange={(event) => set({ title: event.target.value })} placeholder="Reels da promoção" />
        </label>
        <div className="nai-fields">
          <ComboField label="Tipo" value={d.typeKey} options={deliveryTypes.map((type) => ({ value: type.key, label: type.label }))} onChange={(typeKey) => set({ typeKey })} />
          <ComboField label="Formato" value={d.format} options={FORMAT_OPTIONS} onChange={(format) => set({ format: format as NorthFormatKey })} />
          <label className="nai-date"><span>Prazo</span>
            <input type="date" value={d.dueDate} onChange={(event) => set({ dueDate: event.target.value })} />
          </label>
          <ComboField label="Responsável" value={d.assignee} options={assigneeOptions} emptyLabel="Sem responsável" onChange={(assignee) => set({ assignee })} />
          {plans.length ? (
            <ComboField label="Plano" value={d.planId} options={plans.map((plan) => ({ value: plan.id, label: plan.title }))} emptyLabel="Sem plano" onChange={(planId) => set({ planId })} />
          ) : null}
        </div>
        <div className="pac-panel nai-qty">
          <QtyField label="Quantidade de entregas" value={d.count} onChange={(next) => set({ count: Math.max(1, next) })} />
        </div>
      </div>
    );
  }

  const d = drafts.automacao;
  const set = (patch: Partial<typeof d>) => onDrafts((current) => ({ ...current, automacao: { ...current.automacao, ...patch } }));
  return (
    <div className="nai-form">
      <ComboField
        label="Automação"
        value={d.automationKey}
        options={AUTOMATION_KEYS.map((key) => ({ value: key, label: AUTOMATION_DEFINITIONS[key].label }))}
        onChange={(automationKey) => set({ automationKey })}
      />
      <p className="nai-muted">{AUTOMATION_DEFINITIONS[d.automationKey as keyof typeof AUTOMATION_DEFINITIONS]?.description}</p>
      <ComboField
        label="Onde roda"
        value={d.mode}
        options={[{ value: "new", label: "Numa rotina nova" }, ...(routines.length ? [{ value: "existing", label: "Numa rotina existente" }] : [])]}
        onChange={(mode) => set({ mode: mode as "new" | "existing" })}
      />
      {d.mode === "existing" ? (
        <ComboField label="Rotina" value={d.targetTaskId} options={routines.map((routine) => ({ value: routine.id, label: routine.title }))} onChange={(targetTaskId) => set({ targetTaskId })} />
      ) : (
        <>
          <label className="nai-text"><span>Nome da rotina</span>
            <input value={d.newTitle} onChange={(event) => set({ newTitle: event.target.value })} />
          </label>
          <div className="nai-fields">
            <ComboField label="Repete" value={d.cadence} options={REPEAT_OPTIONS} onChange={(cadence) => set({ cadence: cadence as Cadence })} />
            <label className="nai-date"><span>Começa</span>
              <input type="date" value={d.startDate} onChange={(event) => set({ startDate: event.target.value })} />
            </label>
            <ComboField label="Responsável" value={d.assignee} options={assigneeOptions} emptyLabel="Sem responsável" onChange={(assignee) => set({ assignee })} />
          </div>
        </>
      )}
    </div>
  );
}
