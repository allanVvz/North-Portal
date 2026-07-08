"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useSiteTheme } from "../useSiteTheme";

// Recuperar Senha (Figma 411:1638) + Sucesso (411:1695) as one flow.
export default function RecuperarSenhaPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [theme, toggleTheme] = useSiteTheme();

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    const supabase = createClient();
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: typeof window !== "undefined" ? `${window.location.origin}/login` : undefined,
    });
    setBusy(false);
    setSent(true);
  }

  return (
    <main className="auth-screen" data-theme={theme} suppressHydrationWarning>
      <span className="auth-ring" aria-hidden />
      <div className="auth-blob a" aria-hidden />
      <div className="auth-blob b" aria-hidden />
      <button
        type="button"
        className="auth-theme-toggle"
        onClick={toggleTheme}
        aria-label={theme === "light" ? "Ativar tema escuro" : "Ativar tema claro"}
        title={theme === "light" ? "Tema escuro" : "Tema claro"}
      >
        {theme === "light" ? "☾" : "☀"}
      </button>
      {sent ? (
        <div className="auth-card" style={{ textAlign: "center", alignItems: "center" }}>
          <span className="auth-check" aria-hidden>✓</span>
          <h1 className="auth-title">Link <span className="accent">enviado</span></h1>
          <p className="auth-lead">
            Se existir uma conta para <strong>{email}</strong>, você receberá um e-mail com o link de redefinição.
          </p>
          <Link href="/login" className="auth-submit" style={{ textDecoration: "none", textAlign: "center" }}>
            Voltar ao login
          </Link>
        </div>
      ) : (
        <form className="auth-card" onSubmit={onSubmit}>
          <div className="auth-brand">
            <span className="auth-mark" aria-hidden />
            <strong className="wordmark">north</strong>
            <em>Portal</em>
          </div>
          <h1 className="auth-title">Recuperar <span className="accent">senha</span></h1>
          <p className="auth-lead">Informe seu e-mail e enviaremos um link para redefinir sua senha.</p>
          <label className="auth-field">
            <span>E-mail</span>
            <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@empresa.com" />
          </label>
          <button className="auth-submit" type="submit" disabled={busy}>
            {busy ? "Enviando..." : "Enviar link de acesso"}
          </button>
          <Link href="/login" className="auth-help" style={{ margin: "8px 0 0", display: "block" }}>← Voltar ao login</Link>
        </form>
      )}
    </main>
  );
}
