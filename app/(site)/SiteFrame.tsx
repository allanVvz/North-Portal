"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type Theme = "light" | "dark";

const NAV = [
  { href: "/quem-somos", label: "Quem somos" },
  { href: "/como-funciona", label: "Como funciona" },
  { href: "/planos", label: "Planos" },
  { href: "/politica-de-privacidade", label: "Políticas" },
];

export default function SiteFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Starts "light" (matches the server render) and corrects via effect after
  // mount. A lazy localStorage-read initializer was tried and reverted: it
  // diverges from the server-rendered value, which Next.js flags as a
  // hydration mismatch (tree gets discarded and regenerated client-side) —
  // worse than the brief flash it aimed to avoid. See docs/DIVERGENCIAS-FIGMA.md.
  const [theme, setTheme] = useState<Theme>("light");
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem("site-theme");
    if (saved === "dark" || saved === "light") setTheme(saved);
  }, []);
  useEffect(() => {
    window.localStorage.setItem("site-theme", theme);
  }, [theme]);
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const active = (href: string) =>
    href === "/politica-de-privacidade"
      ? pathname.startsWith("/politica") || pathname.startsWith("/termos") || pathname.startsWith("/politica-de-cookies")
      : pathname === href;

  return (
    <div className="site" data-theme={theme} suppressHydrationWarning>
      <header className="site-header">
        <div className="site-header-in">
          <Link href="/" className="site-brand" aria-label="North — início">
            <span className="site-brand-dot" aria-hidden />
            <b>north</b>
            <span>Portal</span>
          </Link>

          <nav className={`site-nav ${menuOpen ? "open" : ""}`}>
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className={active(item.href) ? "active" : ""}>
                {item.label}
              </Link>
            ))}
          </nav>

          <button
            type="button"
            className="site-theme"
            onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
            aria-label={theme === "light" ? "Ativar tema escuro" : "Ativar tema claro"}
            title={theme === "light" ? "Tema escuro" : "Tema claro"}
          >
            {theme === "light" ? "☾" : "☀"}
          </button>
          <Link href="/login" className="site-btn solid" style={{ padding: "9px 18px" }}>
            Entrar
          </Link>
          <button
            type="button"
            className="site-burger"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Abrir menu"
            aria-expanded={menuOpen}
          >
            {menuOpen ? "✕" : "☰"}
          </button>
        </div>
      </header>

      <main className="site-main">{children}</main>

      <footer className="site-footer">
        <div className="site-footer-in">
          <div className="foot-brand">
            <Link href="/" className="site-brand" style={{ color: "var(--s-petrol-ink)" }}>
              <span className="site-brand-dot" aria-hidden />
              <b>north</b>
              <span>Portal</span>
            </Link>
            <p className="foot-about">
              O portal premium que reúne sua operação de marketing com a North — guiado por uma bússola.
            </p>
            <div className="foot-social">
              <a href="#" aria-label="LinkedIn">in</a>
              <a href="#" aria-label="Instagram">ig</a>
              <a href="#" aria-label="Behance">be</a>
            </div>
          </div>
          <div className="foot-col">
            <h4>Produto</h4>
            <Link href="/">Recursos</Link>
            <Link href="/como-funciona">Como funciona</Link>
            <Link href="/planos">Planos</Link>
          </div>
          <div className="foot-col">
            <h4>Empresa</h4>
            <Link href="/quem-somos">Quem somos</Link>
            <a href="mailto:contato@north.test">Contato</a>
            <Link href="/quem-somos">Carreiras</Link>
          </div>
          <div className="foot-col">
            <h4>Legal</h4>
            <Link href="/politica-de-privacidade">Política de Privacidade</Link>
            <Link href="/termos-de-uso">Termos de Uso</Link>
            <Link href="/politica-de-cookies">Política de Cookies</Link>
          </div>
        </div>
        <div className="site-footer-base">
          <span>© 2026 North · agência de marketing &amp; tráfego</span>
          <a href="mailto:contato@north.test">contato@north.test</a>
        </div>
      </footer>
    </div>
  );
}
