"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import TaskKindIcon from "./TaskKindIcon";
import { contentPlanSteps, type ContentVolume } from "./contentPlan";
import { normalizeSearchText } from "@/lib/taskSearch";

// "Adicionar ao plano" — UMA caixa para as três formas de encher um plano, no
// lugar do bloco fixo "Plano de conteúdo" (três campos numéricos + texto longo,
// sempre aberto) e do "Buscar ou criar atividade" com formulário próprio:
//
//   - digitar busca cards soltos do cliente e vincula com um clique;
//   - ao clicar, abre a lista do que dá para criar, cada opção com quantidade:
//     conteúdos (Reels/Anúncios/Carrosséis viram as etapas agrupadas de
//     contentPlan.ts) e cards de cada tipo (uma Entrega nasce como fluxo);
//   - o que foi escolhido vira chip dentro da caixa, e um único botão cria tudo.
//
// Responsável e prazo não são perguntados aqui: nascem com os do plano e se
// ajustam depois na própria linha da atividade (StepRow). Menos formulário,
// mais ação.

export type PlanAddItem = { title: string; kind: string; description?: string; offsetDays?: number };

type TypeOption = { key: string; label: string; behavior: string };

const CONTENT_ROWS: { key: keyof ContentVolume; label: string; hint: string }[] = [
  { key: "reels", label: "Reels", hint: "vídeo" },
  { key: "anuncios", label: "Anúncios", hint: "vídeo de mídia paga" },
  { key: "carrosseis", label: "Carrosséis", hint: "design" },
];
const EMPTY_VOLUME: ContentVolume = { reels: 0, anuncios: 0, carrosseis: 0 };
const MAX = 30;
const clamp = (n: number) => Math.max(0, Math.min(MAX, Number.isFinite(n) ? Math.trunc(n) : 0));

function QtyRow({ icon, label, hint, value, onChange }: {
  icon?: React.ReactNode;
  label: string;
  hint?: string;
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className={`pac-row${value ? " on" : ""}`}>
      <button type="button" className="pac-row-main" onClick={() => onChange(clamp(value + 1))}>
        {icon}
        <span className="pac-row-label">{label}</span>
        {hint ? <span className="pac-row-hint">{hint}</span> : null}
      </button>
      <div className="pac-qty">
        <button type="button" aria-label={`Menos ${label}`} disabled={!value} onClick={() => onChange(clamp(value - 1))}>−</button>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={MAX}
          aria-label={`Quantidade de ${label}`}
          value={value}
          onFocus={(event) => event.target.select()}
          onChange={(event) => onChange(clamp(Number(event.target.value)))}
        />
        <button type="button" aria-label={`Mais ${label}`} disabled={value >= MAX} onClick={() => onChange(clamp(value + 1))}>+</button>
      </div>
    </div>
  );
}

export default function PlanAddCombobox({
  candidates,
  types,
  defaultType,
  busy,
  contextHint,
  onLinkExisting,
  onCreate,
}: {
  candidates: { id: string; title: string; kind: string }[];
  types: TypeOption[];
  defaultType: string;
  busy: boolean;
  /** "Nascem com Allan · a partir de 15/09" — de onde vêm responsável e prazo. */
  contextHint?: string;
  onLinkExisting: (candidate: { id: string; title: string }) => void;
  onCreate: (items: PlanAddItem[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [volume, setVolume] = useState<ContentVolume>(EMPTY_VOLUME);
  const [typeCounts, setTypeCounts] = useState<Record<string, number>>({});
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const base = query.trim();
  const needle = normalizeSearchText(base);
  const matches = needle ? candidates.filter((c) => normalizeSearchText(c.title).includes(needle)).slice(0, 5) : [];

  const contentSteps = useMemo(() => contentPlanSteps(volume), [volume]);
  const typeItems: PlanAddItem[] = types.flatMap((type) => {
    const n = typeCounts[type.key] ?? 0;
    const title = base || type.label;
    return Array.from({ length: n }, (_, index) => ({ title: n > 1 ? `${title} ${index + 1}` : title, kind: type.key }));
  });
  const items: PlanAddItem[] = [
    ...contentSteps.map((step) => ({ title: step.title, description: step.description, offsetDays: step.offsetDays, kind: "operacional" })),
    ...typeItems,
  ];

  const chips = [
    ...CONTENT_ROWS.filter((row) => volume[row.key] > 0).map((row) => ({
      id: `c-${row.key}`,
      label: `${volume[row.key]} ${row.label}`,
      clear: () => setVolume((current) => ({ ...current, [row.key]: 0 })),
    })),
    ...types.filter((type) => (typeCounts[type.key] ?? 0) > 0).map((type) => ({
      id: `t-${type.key}`,
      label: `${typeCounts[type.key]} × ${type.label}`,
      clear: () => setTypeCounts((current) => ({ ...current, [type.key]: 0 })),
    })),
  ];

  function reset() {
    setQuery("");
    setVolume(EMPTY_VOLUME);
    setTypeCounts({});
    setOpen(false);
  }

  function create() {
    if (busy) return;
    if (items.length) {
      onCreate(items);
      reset();
    } else if (base) {
      onCreate([{ title: base, kind: defaultType }]);
      reset();
    }
  }

  const actionLabel = items.length ? `Criar ${items.length}` : base ? "Criar" : null;
  const preview = [
    contentSteps.length ? `${contentSteps.length} etapas de conteúdo (${contentSteps.map((step) => step.title.split(" — ")[0]).join(", ")})` : "",
    ...types.filter((type) => (typeCounts[type.key] ?? 0) > 0).map((type) => `${typeCounts[type.key]} × ${type.label}${type.behavior === "entrega" ? " com fluxo" : ""}`),
  ].filter(Boolean).join(" + ");
  const defaultTypeLabel = types.find((type) => type.key === defaultType)?.label.toLowerCase() ?? "tarefa";

  return (
    <div className={`pac${open ? " is-open" : ""}`} ref={ref}>
      <div className="pac-box" onClick={() => { setOpen(true); inputRef.current?.focus(); }}>
        <span className="pac-plus" aria-hidden>+</span>
        {chips.map((chip) => (
          <span className="pac-chip" key={chip.id}>
            {chip.label}
            <button type="button" aria-label={`Remover ${chip.label}`} onClick={(event) => { event.stopPropagation(); chip.clear(); }}>✕</button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="pac-input"
          role="combobox"
          aria-expanded={open}
          aria-label="Adicionar ao plano"
          value={query}
          disabled={busy}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); create(); } }}
          placeholder={chips.length ? "Título dos cards (opcional)…" : "Adicionar ao plano — buscar, criar ou gerar conteúdos…"}
        />
        {actionLabel ? (
          <button type="button" className="admin-btn primary pac-create" disabled={busy} onClick={(event) => { event.stopPropagation(); create(); }}>
            {actionLabel}
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="pac-panel">
          {matches.length ? (
            <div className="pac-section">
              <p className="pac-section-title">Vincular existente</p>
              {matches.map((candidate) => (
                <button
                  type="button"
                  key={candidate.id}
                  className="pac-link"
                  disabled={busy}
                  onClick={() => { onLinkExisting(candidate); setQuery(""); }}
                >
                  <TaskKindIcon kind={candidate.kind} size="sm" />
                  <span>{candidate.title}</span>
                  <span className="pac-row-hint">vincular</span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="pac-section">
            <p className="pac-section-title">Conteúdos<span>viram etapas agrupadas: roteiro, gravação, edição, aprovação e publicação</span></p>
            {CONTENT_ROWS.map((row) => (
              <QtyRow
                key={row.key}
                label={row.label}
                hint={row.hint}
                value={volume[row.key]}
                onChange={(next) => setVolume((current) => ({ ...current, [row.key]: next }))}
              />
            ))}
          </div>

          {types.length ? (
            <div className="pac-section">
              <p className="pac-section-title">Cards<span>{base ? `com o título “${base}”` : "com o nome do tipo, ou digite um título acima"}</span></p>
              {types.map((type) => (
                <QtyRow
                  key={type.key}
                  icon={<TaskKindIcon kind={type.key} size="sm" />}
                  label={type.label}
                  hint={type.behavior === "entrega" ? "fluxo em cascata" : undefined}
                  value={typeCounts[type.key] ?? 0}
                  onChange={(next) => setTypeCounts((current) => ({ ...current, [type.key]: next }))}
                />
              ))}
            </div>
          ) : null}

          <div className="pac-foot">
            <span>
              {items.length
                ? `Vai criar ${preview}.`
                : base
                  ? `Enter cria a ${defaultTypeLabel} “${base}”.`
                  : "Escolha as quantidades ou digite um título."}
            </span>
            {contextHint ? <span className="pac-foot-context">{contextHint}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
