"use client";

import Link from "next/link";
import { useSiteTheme } from "./useSiteTheme";

// Branded 404 (Figma 411:1734): giant translucent numeral + thin ring directly on the
// blurred background — deliberately NOT wrapped in the glass .auth-card used elsewhere.
export default function NotFound() {
  const [theme, toggleTheme] = useSiteTheme();

  return (
    <main className="auth-screen nf-screen" data-theme={theme} suppressHydrationWarning>
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

      <div className="nf-content">
        <span className="nf-ring" aria-hidden />
        <p className="nf-num">404</p>
        <h1 className="auth-title">Página não encontrada</h1>
        <p className="auth-lead">A página que você buscou não existe ou foi movida.</p>
        <Link href="/" className="auth-submit" style={{ textDecoration: "none", textAlign: "center" }}>
          ← Voltar ao início
        </Link>
      </div>
    </main>
  );
}
