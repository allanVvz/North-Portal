"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function NewClientPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [email, setEmail] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ slug: string; email: string; password: string } | null>(null);

  const effectiveSlug = slugTouched ? slug : slugify(name);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const res = await fetch("/api/admin/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), slug: effectiveSlug, email: email.trim(), is_active: isActive }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Não foi possível criar o cliente.");
      return;
    }
    setCreated({ slug: effectiveSlug, email: data.credentials?.email ?? email.trim(), password: data.credentials?.password ?? "" });
  }

  if (created) {
    return (
      <section className="admin-page admin-narrow">
        <header className="admin-head">
          <div>
            <p className="admin-crumb">
              <Link href="/admin" className="admin-btn ghost" style={{ padding: 0 }}>
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
            Uma conta de acesso ao portal foi criada automaticamente com senha padrão. Repasse estas credenciais ao
            cliente — ele deve trocar a senha no primeiro acesso.
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
            <Link href="/admin" className="admin-btn ghost" style={{ padding: 0 }}>
              Clientes
            </Link>{" "}
            › Novo
          </p>
          <h1 className="admin-title">Cadastrar cliente</h1>
        </div>
      </header>

      <form className="admin-grid" onSubmit={onSubmit}>
        <div className="admin-form">
          <div className="admin-card">
            <p className="admin-card-title">Dados do cliente</p>
            <div className="admin-field-row">
              <label className="admin-field">
                <span>Nome do cliente</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex.: Karpinski Detalhamento"
                  required
                  autoFocus
                />
              </label>
              <label className="admin-field">
                <span>Slug (URL do portal)</span>
                <input
                  value={effectiveSlug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(e.target.value);
                  }}
                  placeholder="karpinski"
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  title="Somente letras minúsculas, números e hífens."
                  required
                />
              </label>
            </div>
            <p className="admin-hint">O portal do cliente ficará em /{effectiveSlug || "slug"}</p>

            <label className="admin-field">
              <span>E-mail de acesso do cliente</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="cliente@empresa.com"
                required
              />
            </label>
            <p className="admin-hint">
              Um login de acesso ao portal é criado automaticamente para este e-mail, com senha padrão.
            </p>

            <label className="admin-toggle">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              <span className="sw" />
              <span>Ativar imediatamente (cliente já pode acessar o portal)</span>
            </label>

            {error ? <p className="admin-error">{error}</p> : null}
          </div>
        </div>

        <aside className="admin-summary">
          <h3>Ao criar</h3>
          <ul>
            <li>
              <span className="ck">✓</span>Registro em <code className="admin-slug">clients</code>
            </li>
            <li>
              <span className="ck">✓</span>Linhas de briefing, links e resultados
            </li>
            <li>
              <span className="ck">✓</span>Checkpoints comerciais provisionados
            </li>
            <li>
              <span className="ck">✓</span>Login de acesso com senha padrão
            </li>
            <li>
              <span className="ck">✓</span>Portal acessível via RLS por slug
            </li>
          </ul>
          <div className="admin-form-actions">
            <button className="admin-btn primary" type="submit" disabled={busy || !name.trim() || !email.trim()}>
              {busy ? "Criando..." : "Criar cliente"}
            </button>
            <Link href="/admin" className="admin-btn">
              Cancelar
            </Link>
          </div>
        </aside>
      </form>
    </section>
  );
}
