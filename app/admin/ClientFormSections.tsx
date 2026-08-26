"use client";

import { useState } from "react";
import type { CheckpointTemplate, ScopeTag, AdAccountOption } from "@/lib/supabase";
import { PLANO_TIERS } from "@/lib/validation";
import { PLANO_LABEL, type CompanyInfoState, type ContractState } from "./clientForm";

export { EMPTY_COMPANY, EMPTY_CONTRACT, parseValorMensal } from "./clientForm";
export type { CompanyInfoState, ContractState } from "./clientForm";

// Form sections shared by "Cadastrar cliente" (app/admin/novo) and "Editar
// cliente" (app/admin/ClientEditor). They exist so the two screens can't drift
// again — before this, creation had 4 fields and editing had a different set
// entirely. Presentation only: state and persistence stay with the parent.

// ---- Dados da empresa --------------------------------------------------------

export function CompanyInfoSection({
  name,
  onName,
  value,
  onChange,
  slugField,
}: {
  name: string;
  onName: (v: string) => void;
  value: CompanyInfoState;
  onChange: (patch: Partial<CompanyInfoState>) => void;
  slugField?: React.ReactNode;
}) {
  return (
    <fieldset className="admin-group">
      <legend>Dados da empresa</legend>
      <div className="admin-grid2">
        <label className="admin-field">
          <span>Nome da empresa</span>
          <input value={name} onChange={(e) => onName(e.target.value)} required placeholder="Baita Conveniência" />
        </label>
        <label className="admin-field">
          <span>Segmento</span>
          <input
            value={value.segmento}
            onChange={(e) => onChange({ segmento: e.target.value })}
            placeholder="Conveniência, bar, delivery"
          />
        </label>
        <label className="admin-field">
          <span>Cidade / UF</span>
          <input value={value.cidadeUf} onChange={(e) => onChange({ cidadeUf: e.target.value })} placeholder="Ponta Grossa / PR" />
        </label>
        <label className="admin-field">
          <span>Instagram / site</span>
          <input
            value={value.instagramOuSite}
            onChange={(e) => onChange({ instagramOuSite: e.target.value })}
            placeholder="@baita"
          />
        </label>
      </div>
      {slugField}
    </fieldset>
  );
}

// ---- Plano, escopo & responsável ---------------------------------------------

export function PlanScopeSection({
  value,
  onChange,
  tags,
  onCreateTag,
}: {
  value: ContractState;
  onChange: (patch: Partial<ContractState>) => void;
  tags: ScopeTag[];
  onCreateTag: (label: string) => Promise<ScopeTag | null>;
}) {
  const [newTag, setNewTag] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const picked = new Map(value.escopo.map((s) => [s.key, s]));

  function toggle(tag: ScopeTag) {
    if (picked.has(tag.key)) {
      onChange({ escopo: value.escopo.filter((s) => s.key !== tag.key) });
    } else {
      onChange({ escopo: [...value.escopo, tag.has_quantity ? { key: tag.key, quantity: 1 } : { key: tag.key }] });
    }
  }

  function setQuantity(key: string, quantity: number) {
    onChange({ escopo: value.escopo.map((s) => (s.key === key ? { ...s, quantity } : s)) });
  }

  async function submitNewTag() {
    const label = newTag.trim();
    if (!label) return;
    setBusy(true);
    const tag = await onCreateTag(label);
    setBusy(false);
    if (tag) {
      // Creating a tag also selects it — the admin typed it because this client
      // has it in scope.
      if (!picked.has(tag.key)) {
        onChange({ escopo: [...value.escopo, tag.has_quantity ? { key: tag.key, quantity: 1 } : { key: tag.key }] });
      }
      setNewTag("");
      setAdding(false);
    }
  }

  return (
    <fieldset className="admin-group">
      <legend>Plano &amp; escopo</legend>

      <div className="admin-field">
        <span>Plano</span>
        <div className="admin-chiprow">
          {PLANO_TIERS.map((tier) => (
            <button
              key={tier}
              type="button"
              className={`admin-chip${value.planoTier === tier ? " active" : ""}`}
              onClick={() => onChange({ planoTier: value.planoTier === tier ? "" : tier })}
              aria-pressed={value.planoTier === tier}
            >
              {PLANO_LABEL[tier]}
            </button>
          ))}
        </div>
      </div>

      <div className="admin-field">
        <span>Escopo contratado</span>
        <div className="admin-chiprow">
          {tags.map((tag) => {
            const sel = picked.get(tag.key);
            return (
              <span key={tag.key} className="admin-chipwrap">
                <button
                  type="button"
                  className={`admin-chip${sel ? " active" : ""}`}
                  onClick={() => toggle(tag)}
                  aria-pressed={Boolean(sel)}
                >
                  {sel && tag.has_quantity ? `${sel.quantity ?? 1} ${tag.label}` : tag.label}
                </button>
                {sel && tag.has_quantity ? (
                  <input
                    className="admin-chipqty"
                    type="number"
                    min={1}
                    max={999}
                    value={sel.quantity ?? 1}
                    onChange={(e) => setQuantity(tag.key, Math.max(1, Number(e.target.value) || 1))}
                    aria-label={`Quantidade de ${tag.label}`}
                  />
                ) : null}
              </span>
            );
          })}

          {adding ? (
            <span className="admin-chipwrap">
              <input
                className="admin-chipnew"
                autoFocus
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void submitNewTag();
                  }
                  if (e.key === "Escape") {
                    setAdding(false);
                    setNewTag("");
                  }
                }}
                placeholder="Nome da tag"
                disabled={busy}
              />
              <button type="button" className="admin-chip" onClick={() => void submitNewTag()} disabled={busy}>
                {busy ? "…" : "Salvar"}
              </button>
            </span>
          ) : (
            <button type="button" className="admin-chip ghost" onClick={() => setAdding(true)}>
              + Nova tag
            </button>
          )}
        </div>
      </div>

      <div className="admin-grid2">
        <label className="admin-field">
          <span>Valor mensal</span>
          <input
            value={value.valorMensal}
            onChange={(e) => onChange({ valorMensal: e.target.value })}
            placeholder="R$ 3.200"
            inputMode="decimal"
          />
        </label>
        <label className="admin-field">
          <span>Início do contrato</span>
          <input type="date" value={value.contractStart} onChange={(e) => onChange({ contractStart: e.target.value })} />
        </label>
      </div>
    </fieldset>
  );
}

// ---- Checkpoints comerciais ---------------------------------------------------

export function CheckpointsSection({
  templates,
  selected,
  onToggle,
}: {
  templates: CheckpointTemplate[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const active = templates.filter((t) => t.active);
  if (active.length === 0) return null;
  const requiredCount = active.filter((t) => t.required).length;
  const picked = new Set(selected);

  return (
    <fieldset className="admin-group">
      <legend>Checkpoints comerciais</legend>
      <div className="admin-chiprow">
        {active.map((t) => {
          const on = t.required || picked.has(t.id);
          return (
            <button
              key={t.id}
              type="button"
              className={`admin-chip${on ? " active" : ""}${t.required ? " locked" : ""}`}
              onClick={() => !t.required && onToggle(t.id)}
              disabled={t.required}
              aria-pressed={on}
              title={t.description ?? undefined}
            >
              {on ? "✓ " : ""}
              {t.title}
              {t.required ? null : <em className="admin-chiptag">opcional</em>}
            </button>
          );
        })}
      </div>
      <p className="admin-hint">
        {requiredCount} obrigatório{requiredCount === 1 ? "" : "s"} — entram sempre e não podem ser removidos. Cada
        checkpoint marcado vira um card no Kanban do cliente.
      </p>
    </fieldset>
  );
}

// ---- Vínculo de conta ---------------------------------------------------------

export function AccountLinkSection({
  driveConfigured,
  driveShareEmail,
  onDriveShareEmail,
  accounts,
  adAccountId,
  onAdAccountId,
}: {
  driveConfigured: boolean;
  driveShareEmail: string;
  onDriveShareEmail: (v: string) => void;
  accounts: AdAccountOption[];
  adAccountId: string;
  onAdAccountId: (v: string) => void;
}) {
  return (
    <fieldset className="admin-group">
      <legend>Vínculo de conta</legend>
      <div className="admin-grid2">
        <label className="admin-field">
          <span>Compartilhar pastas do Drive com</span>
          <input
            type="email"
            value={driveShareEmail}
            onChange={(e) => onDriveShareEmail(e.target.value)}
            placeholder="cliente@empresa.com"
            disabled={!driveConfigured}
          />
          {!driveConfigured ? <em className="admin-warn">Google Drive não conectado — configure em Configurações › Integrações.</em> : null}
        </label>
        <label className="admin-field">
          <span>Conta de anúncios (Meta/Windsor)</span>
          <select value={adAccountId} onChange={(e) => onAdAccountId(e.target.value)} disabled={accounts.length === 0}>
            <option value="">{accounts.length === 0 ? "Nenhuma conta conectada" : "Não vincular"}</option>
            {accounts.map((a) => (
              <option key={a.accountId} value={a.accountId}>
                {a.accountName} · ••••{a.accountId.slice(-4)}
              </option>
            ))}
          </select>
          {accounts.length === 0 ? (
            <em className="admin-warn">Nenhuma conta conectada — configure em Configurações › Integrações.</em>
          ) : null}
        </label>
      </div>
    </fieldset>
  );
}

// ---- Responsável --------------------------------------------------------------

export function ResponsibleSection({
  value,
  onChange,
  children,
}: {
  value: ContractState;
  onChange: (patch: Partial<ContractState>) => void;
  children?: React.ReactNode;
}) {
  return (
    <fieldset className="admin-group">
      <legend>Responsável &amp; acesso do cliente</legend>
      <div className="admin-grid2">
        <label className="admin-field">
          <span>Responsável</span>
          <input
            value={value.responsavelNome}
            onChange={(e) => onChange({ responsavelNome: e.target.value })}
            placeholder="Nome do contato"
          />
        </label>
        <label className="admin-field">
          <span>WhatsApp</span>
          <input
            value={value.responsavelWhatsapp}
            onChange={(e) => onChange({ responsavelWhatsapp: e.target.value })}
            placeholder="(00) 00000-0000"
          />
        </label>
      </div>
      {children}
    </fieldset>
  );
}
