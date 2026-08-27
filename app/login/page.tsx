"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useSiteTheme } from "../useSiteTheme";
import CompassMark from "../CompassMark";

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const nextParam = params.get("next");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [theme, toggleTheme] = useSiteTheme();

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const supabase = createClient();
    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError || !data.user) {
      setBusy(false);
      setError("Email ou senha invalidos.");
      return;
    }
    const meta = data.user.app_metadata ?? {};
    const role = meta.role as string | undefined;
    const slug = meta.client_slug as string | undefined;
    // Keep in sync with `homeFor` in middleware.ts — that one only fires when an
    // already-authenticated user hits /login, this one runs right after sign-in.
    const dest = nextParam ?? (role === "admin" ? "/admin/home" : slug ? `/${slug}` : "/");
    router.replace(dest);
    router.refresh();
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
      <form className="auth-card" onSubmit={onSubmit}>
        <div className="auth-brand">
          <span className="auth-mark" aria-hidden><CompassMark size={18} /></span>
          <strong className="wordmark">north</strong>
          <em>Portal</em>
        </div>
        <h1 className="auth-title">
          Entrar no <span className="accent">portal</span>
        </h1>
        <p className="auth-lead">Acesse sua área North com clareza.</p>

        <label className="auth-field">
          <span>E-mail</span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="voce@empresa.com"
          />
        </label>
        <label className="auth-field">
          <span>Senha</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Sua senha"
          />
        </label>

        {error ? <p className="auth-error">{error}</p> : null}

        <button className="auth-submit" type="submit" disabled={busy}>
          {busy ? "Entrando..." : "Entrar →"}
        </button>
        <div className="auth-foot">
          <a className="auth-help" href="/recuperar-senha" style={{ margin: 0 }}>
            Esqueceu a senha?
          </a>
          <span className="auth-secure">Acesso seguro · RLS</span>
        </div>
      </form>
      <span className="auth-pagefoot">North Portal — agência de marketing &amp; tráfego</span>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
