"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type Theme = "light" | "dark";

const NAV_GROUPS: { head: string; items: { href: string; ico: string; label: string }[] }[] = [
  {
    head: "Operação",
    items: [
      { href: "/admin", ico: "◔", label: "Clientes" },
      { href: "/admin/kanban", ico: "▤", label: "Tarefas" },
      { href: "/admin/revisoes", ico: "◑", label: "Revisões" },
      { href: "/admin/aprovacoes", ico: "✓", label: "Aprovações" },
    ],
  },
  {
    head: "Conteúdo",
    items: [
      { href: "/admin/documentos", ico: "▦", label: "Documentos" },
      { href: "/admin/onboarding", ico: "◇", label: "Onboarding" },
    ],
  },
  {
    head: "Resultados",
    items: [
      { href: "/admin/performance", ico: "▤", label: "Performance" },
      { href: "/admin/plano", ico: "◈", label: "Plano de Ação" },
    ],
  },
  {
    head: "Sistema",
    items: [{ href: "/admin/configuracoes", ico: "⚙", label: "Configurações" }],
  },
];

// Every /admin/* section route; used so the "Clientes" (/admin) item does not
// stay highlighted when a more specific section is active.
const SECTION_HREFS = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href)).filter((h) => h !== "/admin");

export default function AdminShell({
  email,
  name,
  initials,
  children,
}: {
  email: string;
  name: string;
  initials: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  // Starts "light" (matches the server render) and corrects via effect after
  // mount. A lazy localStorage-read initializer was tried and reverted: it
  // diverges from the server-rendered value, which Next.js flags as a
  // hydration mismatch (tree gets discarded and regenerated client-side) —
  // worse than the brief flash it aimed to avoid. See docs/DIVERGENCIAS-FIGMA.md.
  const [theme, setTheme] = useState<Theme>("light");
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem("admin-theme");
    if (saved === "dark" || saved === "light") setTheme(saved);
  }, []);
  useEffect(() => {
    window.localStorage.setItem("admin-theme", theme);
  }, [theme]);

  // the Aparência control in Configurações broadcasts theme changes
  useEffect(() => {
    function onThemeChange(event: Event) {
      const next = (event as CustomEvent).detail;
      if (next === "light" || next === "dark") setTheme(next);
    }
    window.addEventListener("admin-theme-change", onThemeChange);
    return () => window.removeEventListener("admin-theme-change", onThemeChange);
  }, []);

  // close the account panel on outside click / Escape
  useEffect(() => {
    if (!accountOpen) return;
    function onDown(event: MouseEvent) {
      if (accountRef.current && !accountRef.current.contains(event.target as Node)) {
        setAccountOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setAccountOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [accountOpen]);

  function isActive(href: string): boolean {
    if (href === "/admin") {
      // Clientes: also covers /admin/novo and /admin/<slug> editor, but not other sections
      if (SECTION_HREFS.some((h) => pathname === h || pathname.startsWith(`${h}/`))) return false;
      return pathname === "/admin" || pathname.startsWith("/admin/");
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <div className="admin-shell" data-theme={theme} suppressHydrationWarning>
      <aside className="admin-sidebar">
        <div className="admin-topline">
          <Link href="/admin" className="admin-brand">
            <span className="admin-mark">N</span>
            <span className="admin-word">NORTH</span>
            <span className="admin-role">admin</span>
          </Link>
          <button
            type="button"
            className="admin-theme-toggle"
            onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
            aria-label={theme === "light" ? "Ativar tema escuro" : "Ativar tema claro"}
            title={theme === "light" ? "Tema escuro" : "Tema claro"}
          >
            {theme === "light" ? "☾" : "☀"}
          </button>
        </div>

        {NAV_GROUPS.map((group) => (
          <div className="admin-nav-group" key={group.head}>
            <p className="admin-nav-head">{group.head}</p>
            {group.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`admin-nav-item ${isActive(item.href) ? "active" : ""}`}
              >
                <span className="admin-nav-ico">{item.ico}</span>
                {item.label}
              </Link>
            ))}
          </div>
        ))}

        <div className="admin-side-foot">
          <div className="admin-account" ref={accountRef}>
            {accountOpen ? (
              <div className="admin-account-panel" role="menu">
                <div className="admin-account-head">
                  <span className="admin-avatar">{initials}</span>
                  <span className="admin-usermeta">
                    <span className="admin-username">{name}</span>
                    <span className="admin-useremail" title={email}>
                      {email}
                    </span>
                  </span>
                </div>
                <a className="admin-account-item" href="/logout" role="menuitem">
                  <span className="admin-account-ico" aria-hidden>
                    ⎋
                  </span>
                  Sair
                </a>
              </div>
            ) : null}

            <button
              type="button"
              className="admin-usercard"
              onClick={() => setAccountOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={accountOpen}
            >
              <span className="admin-avatar">{initials}</span>
              <span className="admin-usermeta">
                <span className="admin-username">{name}</span>
                <span className="admin-useremail" title={email}>
                  {email}
                </span>
              </span>
              <span className="admin-usercard-caret" aria-hidden>
                ⌄
              </span>
            </button>
          </div>
        </div>
      </aside>

      <main className="admin-main">{children}</main>
    </div>
  );
}
