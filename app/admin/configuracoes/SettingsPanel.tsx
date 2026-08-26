"use client";

import { useEffect, useState } from "react";
import type { AgencyProfile, CheckpointTemplate, LegalDoc, TeamMember } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/client";
import CheckpointTemplates from "./CheckpointTemplates";
import EtapasPanel from "./EtapasPanel";
import AiProviderIntegration from "./AiProviderIntegration";
import DriveIntegration from "./DriveIntegration";
import MetaIntegration from "./MetaIntegration";
import WindsorIntegration from "./WindsorIntegration";
import NotificationsSettings from "./NotificationsSettings";
import { useSidebarEnabledPref } from "../kanbanPrefs";

const PROFILE_PHOTO_STORAGE_KEY = "admin-profile-photo-mock";

// Automações foi promovida de aba daqui pra tela própria no menu principal
// (/admin/automacoes) em 2026-08-21 — ver plan/AUTOMACOES-RELATORIO-TRAFEGO.md.
type Tab = "perfil" | "equipe" | "politicas" | "notificacoes" | "etapas" | "checkpoints" | "faturamento" | "integracoes";
const TABS: { key: Tab; label: string }[] = [
  { key: "perfil", label: "Perfil da agência" },
  { key: "equipe", label: "Equipe & papéis" },
  { key: "politicas", label: "Políticas" },
  { key: "notificacoes", label: "Notificações" },
  { key: "etapas", label: "Etapas" },
  { key: "checkpoints", label: "Checkpoints comerciais" },
  { key: "faturamento", label: "Faturamento" },
  { key: "integracoes", label: "Integrações" },
];

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${d.getDate()} ${MES[d.getMonth()]} ${d.getFullYear()}`;
}

export default function SettingsPanel({
  legalDocs,
  agency,
  team,
  checkpointTemplates,
  clients,
  currentUser,
}: {
  legalDocs: LegalDoc[];
  agency: AgencyProfile;
  team: TeamMember[];
  checkpointTemplates: CheckpointTemplate[];
  clients: { slug: string; name: string }[];
  currentUser: { fullName: string; email: string };
}) {
  const [tab, setTab] = useState<Tab>("perfil");

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    if (requested && TABS.some((t) => t.key === requested)) setTab(requested as Tab);
  }, []);

  return (
    <div className="set">
      <nav className="set-nav">
        {TABS.map((t) => (
          <button key={t.key} className={`set-nav-item ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </nav>

      <div className="set-body">
        {tab === "perfil" ? (
          <>
            <MyAccountForm initial={currentUser} />
            <AgencyForm initial={agency} />
          </>
        ) : null}
        {tab === "equipe" ? <TeamList team={team} /> : null}
        {tab === "politicas" ? (
          <>
            <LegalDocs initial={legalDocs} />
            <PlanoVisibilitySwitch />
            <Appearance />
          </>
        ) : null}
        {tab === "notificacoes" ? <NotificationsSettings /> : null}
        {tab === "etapas" ? <EtapasPanel clients={clients} /> : null}
        {tab === "checkpoints" ? <CheckpointTemplates initial={checkpointTemplates} /> : null}
        {tab === "faturamento" ? (
          <div className="set-card set-empty">
            <h2 className="set-h">Faturamento</h2>
            <p className="admin-sub">Planos, faturas e método de pagamento. <span className="admin-soon">em breve</span></p>
          </div>
        ) : null}
        {tab === "integracoes" ? (
          <>
            <MetaIntegration clients={clients} />
            <WindsorIntegration clients={clients} />
            <AiProviderIntegration />
            <DriveIntegration />
          </>
        ) : null}
      </div>
    </div>
  );
}

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.length ? words.slice(0, 2).map((w) => w[0]).join("").toUpperCase() : "AD";
}

function MyAccountForm({ initial }: { initial: { fullName: string; email: string } }) {
  const [photo, setPhoto] = useState<string | null>(null);

  const [fullName, setFullName] = useState(initial.fullName || initial.email);
  const [nameBusy, setNameBusy] = useState(false);
  const [nameMsg, setNameMsg] = useState("");

  const [email, setEmail] = useState(initial.email);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMsg, setEmailMsg] = useState("");

  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState("");

  useEffect(() => {
    setPhoto(window.localStorage.getItem(PROFILE_PHOTO_STORAGE_KEY));
  }, []);

  function onPhotoChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      setPhoto(dataUrl);
      window.localStorage.setItem(PROFILE_PHOTO_STORAGE_KEY, dataUrl);
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  }

  function removePhoto() {
    setPhoto(null);
    window.localStorage.removeItem(PROFILE_PHOTO_STORAGE_KEY);
  }

  async function saveName() {
    setNameBusy(true);
    setNameMsg("");
    try {
      const res = await fetch("/api/admin/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: fullName.trim() }),
      });
      setNameMsg(res.ok ? "Salvo." : "Não foi possível salvar.");
    } catch {
      setNameMsg("Não foi possível salvar.");
    }
    setNameBusy(false);
  }

  async function saveEmail() {
    setEmailBusy(true);
    setEmailMsg("");
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ email: email.trim() });
      setEmailMsg(error ? "Não foi possível atualizar o e-mail." : "Confirme o novo e-mail pelo link que acabamos de enviar.");
    } catch {
      setEmailMsg("Não foi possível atualizar o e-mail.");
    }
    setEmailBusy(false);
  }

  async function savePassword() {
    setPasswordMsg("");
    if (password.length < 6) {
      setPasswordMsg("A senha precisa ter ao menos 6 caracteres.");
      return;
    }
    if (password !== passwordConfirm) {
      setPasswordMsg("As senhas não coincidem.");
      return;
    }
    setPasswordBusy(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setPasswordMsg("Não foi possível atualizar a senha.");
      } else {
        setPasswordMsg("Senha atualizada.");
        setPassword("");
        setPasswordConfirm("");
      }
    } catch {
      setPasswordMsg("Não foi possível atualizar a senha.");
    }
    setPasswordBusy(false);
  }

  return (
    <div className="set-card">
      <h2 className="set-h">Minha conta</h2>
      <p className="admin-sub">Seus dados pessoais de acesso.</p>

      <div className="set-avatar-row">
        {/* eslint-disable-next-line @next/next/no-img-element -- local preview of a not-yet-uploaded file; no remote optimization applies */}
        <span className="set-avatar-big">{photo ? <img src={photo} alt="" /> : initialsOf(fullName)}</span>
        <div className="set-avatar-actions">
          <div className="set-avatar-buttons">
            <label className="admin-btn ghost">
              Escolher foto
              <input type="file" accept="image/*" onChange={onPhotoChange} className="set-avatar-input" />
            </label>
            {photo ? <button className="admin-btn ghost" onClick={removePhoto}>Remover</button> : null}
          </div>
          <p className="set-note-inline">Foto de exemplo, salva só neste navegador — upload real chega quando tivermos um bucket de armazenamento configurado.</p>
        </div>
      </div>

      <div className="set-grid">
        <label className="admin-field"><span>Nome de usuário</span>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </label>
      </div>
      <div className="set-actions">
        {nameMsg ? <span className="set-msg">{nameMsg}</span> : <span />}
        <button className="admin-btn primary" onClick={saveName} disabled={nameBusy || !fullName.trim()}>
          {nameBusy ? "Salvando…" : "Salvar nome"}
        </button>
      </div>

      <div className="set-visibility-divider" />

      <div className="set-grid">
        <label className="admin-field"><span>E-mail</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
      </div>
      <div className="set-actions">
        {emailMsg ? <span className="set-msg">{emailMsg}</span> : <span />}
        <button className="admin-btn primary" onClick={saveEmail} disabled={emailBusy || !email.trim()}>
          {emailBusy ? "Salvando…" : "Salvar e-mail"}
        </button>
      </div>

      <div className="set-visibility-divider" />

      <div className="set-grid">
        <label className="admin-field"><span>Nova senha</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 6 caracteres" autoComplete="new-password" />
        </label>
        <label className="admin-field"><span>Confirmar senha</span>
          <input type="password" value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} autoComplete="new-password" />
        </label>
      </div>
      <div className="set-actions">
        {passwordMsg ? <span className="set-msg">{passwordMsg}</span> : <span />}
        <button className="admin-btn primary" onClick={savePassword} disabled={passwordBusy || !password}>
          {passwordBusy ? "Salvando…" : "Alterar senha"}
        </button>
      </div>
    </div>
  );
}

function AgencyForm({ initial }: { initial: AgencyProfile }) {
  const [form, setForm] = useState<AgencyProfile>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function save() {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/admin/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      setMsg(res.ok ? "Salvo." : "Não foi possível salvar.");
    } catch {
      setMsg("Não foi possível salvar.");
    }
    setBusy(false);
  }

  return (
    <div className="set-card">
      <h2 className="set-h">Perfil da agência</h2>
      <p className="admin-sub">Dados exibidos nos e-mails e nas páginas públicas.</p>
      <div className="set-grid">
        <label className="admin-field"><span>Nome</span>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className="admin-field"><span>E-mail de contato</span>
          <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="contato@north.com" />
        </label>
        <label className="admin-field"><span>Site</span>
          <input value={form.site} onChange={(e) => setForm({ ...form, site: e.target.value })} placeholder="https://…" />
        </label>
      </div>
      <label className="admin-field"><span>Nota interna</span>
        <textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
      </label>
      <div className="set-actions">
        {msg ? <span className="set-msg">{msg}</span> : <span />}
        <button className="admin-btn primary" onClick={save} disabled={busy}>{busy ? "Salvando…" : "Salvar"}</button>
      </div>
    </div>
  );
}

function TeamList({ team }: { team: TeamMember[] }) {
  return (
    <div className="set-card">
      <h2 className="set-h">Equipe & papéis</h2>
      <p className="admin-sub">Usuários com acesso à plataforma. Novos acessos são criados via <code>scripts/create-user.mjs</code>.</p>
      <ul className="set-team">
        {team.map((m) => (
          <li key={m.id} className="set-team-row">
            <span className="set-team-name">{m.full_name ?? "—"}</span>
            <span className={`set-role ${m.role}`}>{m.role === "admin" ? "Admin North" : "Cliente"}</span>
          </li>
        ))}
        {team.length === 0 ? <li className="admin-sub">Nenhum perfil.</li> : null}
      </ul>
    </div>
  );
}

function LegalDocs({ initial }: { initial: LegalDoc[] }) {
  const [docs, setDocs] = useState<LegalDoc[]>(initial);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ title: string; body: string; status: LegalDoc["status"] } | null>(null);
  const [busy, setBusy] = useState(false);

  function edit(d: LegalDoc) {
    setEditing(d.slug);
    setDraft({ title: d.title, body: d.body, status: d.status });
  }

  async function save(slug: string) {
    if (!draft) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/legal/${slug}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      if (res.ok) {
        const updated = (await res.json()) as LegalDoc;
        setDocs((rows) => rows.map((r) => (r.slug === slug ? updated : r)));
        setEditing(null);
        setDraft(null);
      }
    } catch { /* keep editing open */ }
    setBusy(false);
  }

  return (
    <div className="set-card">
      <h2 className="set-h">Políticas & documentos legais</h2>
      <p className="admin-sub">Edite e publique os textos exibidos nas páginas públicas.</p>
      <div className="set-legal">
        {docs.map((d) => (
          <div className="set-legal-row" key={d.slug}>
            {editing === d.slug && draft ? (
              <div className="set-legal-editor">
                <label className="admin-field"><span>Título</span>
                  <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
                </label>
                <label className="admin-field"><span>Conteúdo</span>
                  <textarea rows={6} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
                </label>
                <div className="set-actions">
                  <label className="admin-toggle">
                    <input type="checkbox" checked={draft.status === "publicada"} onChange={(e) => setDraft({ ...draft, status: e.target.checked ? "publicada" : "rascunho" })} />
                    <span className="sw" /><span>Publicada</span>
                  </label>
                  <div className="kb-modal-actions-right">
                    <button className="admin-btn ghost" onClick={() => { setEditing(null); setDraft(null); }} disabled={busy}>Cancelar</button>
                    <button className="admin-btn primary" onClick={() => save(d.slug)} disabled={busy}>{busy ? "Salvando…" : "Salvar"}</button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <span className="set-legal-ico">§</span>
                <div className="set-legal-meta">
                  <strong>{d.title}</strong>
                  <span className="admin-sub">Atualizada em {fmtDate(d.updated_at)}</span>
                </div>
                <span className={`set-badge ${d.status}`}>{d.status === "publicada" ? "Publicada" : "Rascunho"}</span>
                <button className="admin-btn ghost" onClick={() => edit(d)}>Editar</button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Platform-wide master switch: when off, every "Visível para o cliente"
// toggle across the app (TaskModal, TaskDetailPanel) is force-disabled and
// no client_visible content reaches the portal (enforced in getPortalPayload).
function PlanoVisibilitySwitch() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch("/api/admin/settings/plano-visibility")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (data) setEnabled(Boolean(data.enabled)); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function toggle(next: boolean) {
    setEnabled(next);
    setMsg("");
    try {
      const res = await fetch("/api/admin/settings/plano-visibility", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) setMsg("Não foi possível salvar.");
    } catch {
      setMsg("Não foi possível salvar.");
    }
  }

  const { sidebarEnabled, setSidebarEnabled } = useSidebarEnabledPref();

  return (
    <div className="set-card">
      <div className="set-appearance-head">
        <div>
          <h2 className="set-h">Visibilidade</h2>
          <p className="admin-sub">Botão mestre do "Visível para o cliente" — desativado, some de toda a plataforma.</p>
        </div>
        <label className="admin-toggle">
          <input type="checkbox" checked={enabled} disabled={loading} onChange={(e) => toggle(e.target.checked)} />
          <span className="sw" /><span>{enabled ? "Ativo" : "Desativado"}</span>
        </label>
      </div>
      {msg ? <span className="set-msg">{msg}</span> : null}

      <div className="set-visibility-divider" />

      <div className="set-appearance-head">
        <div>
          <h3 className="set-h3">Painel lateral do card</h3>
          <p className="admin-sub">Ao abrir uma tarefa no Kanban, mostra o painel lateral como etapa intermediária antes do modal completo. Desligado por padrão — a tarefa abre direto no modal.</p>
        </div>
        <label className="admin-toggle">
          <input type="checkbox" checked={sidebarEnabled} onChange={(e) => setSidebarEnabled(e.target.checked)} />
          <span className="sw" /><span>{sidebarEnabled ? "Ativo" : "Desativado"}</span>
        </label>
      </div>
    </div>
  );
}

function Appearance() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    return window.localStorage.getItem("admin-theme") === "dark" ? "dark" : "light";
  });

  function set(next: "light" | "dark") {
    setTheme(next);
    window.localStorage.setItem("admin-theme", next);
    window.dispatchEvent(new CustomEvent("admin-theme-change", { detail: next }));
  }

  return (
    <div className="set-card">
      <div className="set-appearance-head">
        <div>
          <h2 className="set-h">Aparência</h2>
          <p className="admin-sub">Alterna entre tema claro (Névoa Sage) e escuro (petróleo).</p>
        </div>
        <div className="set-theme-toggle">
          <button className={theme === "light" ? "on" : ""} onClick={() => set("light")}>Claro</button>
          <button className={theme === "dark" ? "on" : ""} onClick={() => set("dark")}>Escuro</button>
        </div>
      </div>
      <p className="set-note">O tema é aplicado em todo o painel e salvo neste navegador.</p>
    </div>
  );
}
