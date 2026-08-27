"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import ConsentBanner from "./components/ConsentBanner";
import { captureAttribution, track } from "./components/analytics";
import { useSiteTheme } from "../useSiteTheme";
import CompassMark from "../CompassMark";

const NAV = [
  { href: "/quem-somos", label: "Quem somos" },
  { href: "/como-funciona", label: "Como funciona" },
  { href: "/planos", label: "Parcerias" },
];

export default function SiteFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  // Compartilhado com /login (mesma chave de localStorage: "site-theme") —
  // trocar o tema aqui ou lá vale para o outro também.
  const [theme, toggleTheme] = useSiteTheme();

  useEffect(() => {
    captureAttribution();
    const onClick = (event: MouseEvent) => { const target = (event.target as HTMLElement).closest<HTMLElement>("[data-track]"); if (target?.dataset.track) track("cta_click", { placement: target.dataset.track }); };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
  useEffect(() => setMenuOpen(false), [pathname]);

  return (
    <div className="site" data-theme={theme} suppressHydrationWarning>
      <a className="skip-link" href="#conteudo">Ir para o conteúdo</a>
      <header className="site-header">
        <div className="site-header-in">
          <Link href="/" className="site-brand" aria-label="North — início">
            <span className="site-compass" aria-hidden><CompassMark size={22} /></span>
            <b>north</b><span>estratégia &amp; operação</span>
          </Link>
          <nav className={`site-nav ${menuOpen ? "open" : ""}`} aria-label="Navegação principal">
            {NAV.map((item) => <Link key={item.href} href={item.href} aria-current={pathname === item.href ? "page" : undefined}>{item.label}</Link>)}
          </nav>
          <Link href="/lp#diagnostico" className="site-btn solid header-cta" data-track="cta_header">Solicitar diagnóstico</Link>
          <button
            type="button"
            className="site-theme"
            onClick={toggleTheme}
            aria-label={theme === "light" ? "Ativar tema escuro" : "Ativar tema claro"}
            title={theme === "light" ? "Tema escuro" : "Tema claro"}
          >
            {theme === "light" ? "☾" : "☀"}
          </button>
          <Link href="/login" className="login-link">Login</Link>
          <button type="button" className="site-burger" onClick={() => setMenuOpen((v) => !v)} aria-label={menuOpen ? "Fechar menu" : "Abrir menu"} aria-expanded={menuOpen}><span /><span /></button>
        </div>
      </header>

      <main id="conteudo" className="site-main">{children}</main>

      <footer className="site-footer">
        <div className="site-footer-in">
          <div className="foot-brand">
            <Link href="/" className="site-brand"><span className="site-compass" aria-hidden><CompassMark size={22} /></span><b>north</b></Link>
            <p>Estratégia, conteúdo e performance para negócios locais que querem crescer com direção.</p>
          </div>
          <div className="foot-col"><h2>Explore</h2><Link href="/como-funciona">Como funciona</Link><Link href="/planos">Modelos de parceria</Link><Link href="/quem-somos">Quem somos</Link></div>
          <div className="foot-col"><h2>Legal</h2><Link href="/politica-de-privacidade">Privacidade</Link><Link href="/termos-de-uso">Termos de uso</Link><Link href="/politica-de-cookies">Cookies</Link><button type="button" onClick={() => window.dispatchEvent(new Event("north:consent"))}>Preferências de cookies</button></div>
          <div className="foot-col"><h2>Contato</h2><a href="mailto:contato@northmarketing.com.br">contato@northmarketing.com.br</a><Link href="/lp#diagnostico">Solicitar diagnóstico</Link></div>
        </div>
        <div className="site-footer-base"><span>© 2026 North. Todos os direitos reservados.</span><span>Brasil · atendimento regional</span></div>
      </footer>
      <ConsentBanner />
    </div>
  );
}
