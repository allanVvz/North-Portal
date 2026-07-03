"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const nextParam = params.get("next");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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
    const dest = nextParam ?? (role === "admin" ? "/admin" : slug ? `/${slug}` : "/");
    router.replace(dest);
    router.refresh();
  }

  return (
    <main className="auth-screen">
      <div className="auth-blob a" aria-hidden />
      <div className="auth-blob b" aria-hidden />
      <form className="auth-card" onSubmit={onSubmit}>
        <div className="auth-brand">
          <span className="auth-mark">n</span>
          <span>
            <strong className="wordmark">north</strong>
            <em>Portal</em>
          </span>
        </div>
        <h1 className="serif auth-title">
          Bem-vindo <span className="accent">de volta</span>
        </h1>
        <p className="auth-lead">Acesse o portal para acompanhar briefing, materiais e resultados.</p>

        <label className="auth-field">
          <span>Email</span>
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
          {busy ? "Entrando..." : "Entrar"}
        </button>
        <p className="auth-help">Esqueceu a senha? Fale com a North para redefinir.</p>
      </form>
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
