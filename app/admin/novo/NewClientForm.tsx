"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AdAccountOption, CheckpointTemplate, LeadRecord, ScopeTag } from "@/lib/supabase";
import {
  AccountLinkSection,
  CheckpointsSection,
  CompanyInfoSection,
  EMPTY_COMPANY,
  EMPTY_CONTRACT,
  PlanScopeSection,
  ResponsibleSection,
  parseValorMensal,
  type CompanyInfoState,
  type ContractState,
} from "../ClientFormSections";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .split("")
    .filter((c) => c.charCodeAt(0) < 128)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

type Created = {
  slug: string;
  email: string;
  password: string;
  drive: { ok: boolean; reason?: string } | null;
  adAccount: { ok: boolean; reason?: string } | null;
};

// Vindo de um lead, o que a pessoa declarou na landing page já responde metade
// do formulário. O que NÃO dá para pré-preencher é o e-mail: o LeadForm coleta
// telefone e não e-mail (ver e2e/public-funnel.spec.ts), e provisionClientAuth
// exige um para criar o login. É por isso que converter não é um clique só —
// alguém precisa informar o e-mail.
//
// A empresa vira o nome do cliente; quem preencheu vira o responsável do
// contrato. Não é lazy-init de localStorage: o lead vem do servidor por prop,
// então o HTML server-rendered e o cliente concordam.
export default function NewClientForm({
  templates,
  scopeTags,
  adAccounts,
  driveConfigured,
  lead = null,
}: {
  templates: CheckpointTemplate[];
  scopeTags: ScopeTag[];
  adAccounts: AdAccountOption[];
  driveConfigured: boolean;
  lead?: LeadRecord | null;
}) {
  const router = useRouter();
  const [name, setName] = useState(lead?.company ?? "");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [email, setEmail] = useState("");
  const [isActive, setIsActive] = useState(true);

  const [company, setCompany] = useState<CompanyInfoState>(
    lead ? { ...EMPTY_COMPANY, segmento: lead.segment, cidadeUf: lead.region } : EMPTY_COMPANY,
  );
  const [contract, setContract] = useState<ContractState>(
    lead ? { ...EMPTY_CONTRACT, responsavelNome: lead.name, responsavelWhatsapp: lead.phone } : EMPTY_CONTRACT,
  );
  const [tags, setTags] = useState<ScopeTag[]>(scopeTags);

  // Optional checkpoints start selected: the Figma shows Kickoff checked by
  // default, and it's the common case.
  const [checkpoints, setCheckpoints] = useState<string[]>(() =>
    templates.filter((t) => t.active && !t.required).map((t) => t.id),
  );

  const [createDrive, setCreateDrive] = useState(true);
  const [driveShareEmail, setDriveShareEmail] = useState("");
  const [adAccountId, setAdAccountId] = useState("");
  const [sendInvite, setSendInvite] = useState(true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<Created | null>(null);

  const effectiveSlug = slugTouched ? slug : slugify(name);
  const scopeCount = contract.escopo.length;
  const checkpointTotal = useMemo(
    () => templates.filter((t) => t.active && (t.required || checkpoints.includes(t.id))).length,
    [templates, checkpoints],
  );

  async function createTag(label: string): Promise<ScopeTag | null> {
    const res = await fetch("/api/admin/scope-tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Não foi possível criar a tag.");
      return null;
    }
    const { tag } = (await res.json()) as { tag: ScopeTag };
    setTags((all) => (all.some((t) => t.key === tag.key) ? all : [...all, tag]));
    return tag;
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const res = await fetch("/api/admin/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        slug: effectiveSlug,
        email: email.trim(),
        is_active: isActive,
        companyInfo: {
          segmento: company.segmento.trim() || null,
          cidadeUf: company.cidadeUf.trim() || null,
          instagramOuSite: company.instagramOuSite.trim() || null,
        },
        contract: {
          planoTier: contract.planoTier || null,
          escopo: contract.escopo,
          valorMensal: parseValorMensal(contract.valorMensal),
          contractStart: contract.contractStart || null,
          responsavelNome: contract.responsavelNome.trim() || null,
          responsavelWhatsapp: contract.responsavelWhatsapp.trim() || null,
        },
        checkpointTemplateIds: checkpoints,
        createDriveFolder: createDrive && driveConfigured,
        driveShareEmail: driveShareEmail.trim() || null,
        adAccountId: adAccountId || null,
        leadId: lead?.id ?? null,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Não foi possível criar o cliente.");
      return;
    }
    setCreated({
      slug: effectiveSlug,
      email: data.credentials?.email ?? email.trim(),
      password: data.credentials?.password ?? "",
      drive: data.drive ?? null,
      adAccount: data.adAccount ?? null,
    });
  }

  if (created) {
    return (
      <section className="admin-page admin-narrow">
        <header className="admin-head">
          <div>
            <p className="admin-crumb">
              <Link href="/admin/clientes" className="admin-btn ghost" style={{ padding: 0 }}>
                Clientes
              </Link>{" "}
              › Novo
            </p>
            <h1 className="admin-title">Cliente criado</h1>
          </div>
        </header>
        <div className="admin-card">
          <p className="admin-card-title">Login de acesso do cliente</p>
          <p className="admin-hint">
            Uma conta de acesso ao portal foi criada com senha padrão. Repasse estas credenciais ao cliente — ele deve
            trocar a senha no primeiro acesso.
          </p>
          <div className="admin-field-row">
            <label className="admin-field">
              <span>E-mail</span>
              <input value={created.email} readOnly />
            </label>
            <label className="admin-field">
              <span>Senha padrão</span>
              <input value={created.password} readOnly />
            </label>
          </div>
          {created.drive && !created.drive.ok ? (
            <p className="admin-error">Pastas do Drive não criadas: {created.drive.reason}</p>
          ) : null}
          {created.adAccount && !created.adAccount.ok ? (
            <p className="admin-error">Conta de anúncios não vinculada: {created.adAccount.reason}</p>
          ) : null}
          <div className="admin-form-actions">
            <button
              className="admin-btn primary"
              type="button"
              onClick={() => {
                router.push(`/admin/${created.slug}`);
                router.refresh();
              }}
            >
              Ir para o cliente
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="admin-page admin-narrow">
      <header className="admin-head">
        <div>
          <p className="admin-crumb">
            <Link href="/admin/clientes" className="admin-btn ghost" style={{ padding: 0 }}>
              Clientes
            </Link>{" "}
            › Novo
          </p>
          <h1 className="admin-title">Cadastrar cliente</h1>
        </div>
      </header>

      <form className="admin-grid" onSubmit={onSubmit}>
        <div className="admin-form">
          <CompanyInfoSection
            name={name}
            onName={setName}
            value={company}
            onChange={(patch) => setCompany((c) => ({ ...c, ...patch }))}
            slugField={
              <>
                <label className="admin-field">
                  <span>Slug (URL do portal)</span>
                  <input
                    value={effectiveSlug}
                    onChange={(e) => {
                      setSlugTouched(true);
                      setSlug(e.target.value);
                    }}
                    placeholder="baita-conveniencia"
                    pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                    title="Somente letras minúsculas, números e hífens."
                    required
                  />
                </label>
                <p className="admin-hint">O portal do cliente ficará em /{effectiveSlug || "slug"}</p>
              </>
            }
          />

          <PlanScopeSection
            value={contract}
            onChange={(patch) => setContract((c) => ({ ...c, ...patch }))}
            tags={tags}
            onCreateTag={createTag}
          />

          <CheckpointsSection
            templates={templates}
            selected={checkpoints}
            onToggle={(id) =>
              setCheckpoints((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))
            }
          />

          <ResponsibleSection value={contract} onChange={(patch) => setContract((c) => ({ ...c, ...patch }))}>
            <div className="admin-grid2">
              <label className="admin-field">
                <span>E-mail de login</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="cliente@empresa.com"
                  required
                />
              </label>
              <label className="admin-field">
                <span>Senha temporária</span>
                <input value="Gerada automaticamente" readOnly />
              </label>
            </div>

            <label className="admin-toggle">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              <span className="sw" />
              <span>Ativar imediatamente (cliente já pode acessar o portal)</span>
            </label>
            {/* No e-mail provider is wired up yet, so this is a reminder for the
                admin rather than an automation — the success screen shows the
                credentials to pass along by hand. */}
            <label className="admin-toggle">
              <input type="checkbox" checked={sendInvite} onChange={(e) => setSendInvite(e.target.checked)} />
              <span className="sw" />
              <span>Enviar convite de acesso por e-mail</span>
              <em className="admin-chiptag">envio manual por ora</em>
            </label>
            {/* briefing_answers is created for every client — the portal assumes
                the row exists — so this reflects what happens instead of gating it. */}
            <label className="admin-toggle">
              <input type="checkbox" checked readOnly disabled />
              <span className="sw" />
              <span>Criar briefing de onboarding</span>
              <em className="admin-chiptag">sempre criado</em>
            </label>
            <label className="admin-toggle">
              <input
                type="checkbox"
                checked={createDrive && driveConfigured}
                onChange={(e) => setCreateDrive(e.target.checked)}
                disabled={!driveConfigured}
              />
              <span className="sw" />
              <span>Criar pasta principal no Google Drive</span>
              {!driveConfigured ? <em className="admin-chiptag">Drive não conectado</em> : null}
            </label>
          </ResponsibleSection>

          <AccountLinkSection
            driveConfigured={driveConfigured}
            driveShareEmail={driveShareEmail}
            onDriveShareEmail={setDriveShareEmail}
            accounts={adAccounts}
            adAccountId={adAccountId}
            onAdAccountId={setAdAccountId}
          />

          {error ? <p className="admin-error">{error}</p> : null}
        </div>

        <aside className="admin-summary">
          <h3>Ao criar</h3>
          <ul>
            <li>
              <span className="ck">✓</span>Usuário cliente (role: client) com RLS
            </li>
            <li>
              <span className="ck">✓</span>Registro em <code className="admin-slug">clients</code> + contrato/escopo
            </li>
            <li>
              <span className="ck">✓</span>Onboarding = briefing do cliente
            </li>
            <li>
              <span className="ck">✓</span>
              {createDrive && driveConfigured ? "Pasta no Drive" : "Pasta do Drive manual"} + kickoff no Kanban
            </li>
          </ul>

          <h3>Resumo</h3>
          <ul className="admin-summary-kv">
            <li>
              <span>Plano</span>
              <strong>{contract.planoTier ? contract.planoTier : "—"}</strong>
            </li>
            <li>
              <span>Escopo</span>
              <strong>
                {scopeCount} {scopeCount === 1 ? "item" : "itens"}
              </strong>
            </li>
            <li>
              <span>Valor mensal</span>
              <strong>{contract.valorMensal || "—"}</strong>
            </li>
            <li>
              <span>Checkpoints</span>
              <strong>{checkpointTotal}</strong>
            </li>
          </ul>
          <p className="admin-hint">Os campos ficam editáveis depois da criação, em Clientes › Editar.</p>

          <div className="admin-form-actions">
            <button className="admin-btn primary" type="submit" disabled={busy || !name.trim() || !email.trim()}>
              {busy ? "Criando..." : "Criar cliente"}
            </button>
            <Link href="/admin/clientes" className="admin-btn">
              Cancelar
            </Link>
          </div>
        </aside>
      </form>
    </section>
  );
}
