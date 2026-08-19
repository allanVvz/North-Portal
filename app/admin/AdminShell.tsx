"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CurrentUserProvider } from "./CurrentUserContext";

type Theme = "light" | "dark";

const NAV_GROUPS: { head: string; items: { href: string; ico: string; label: string; hidden?: boolean }[] }[] = [
  {
    head: "Operação",
    items: [
      { href: "/admin", ico: "◎", label: "Clientes" },
      { href: "/admin/plano", ico: "◈", label: "Plano de Ação" },
      { href: "/admin/kanban", ico: "▤", label: "Tarefas" },
      { href: "/admin/revisoes", ico: "◑", label: "Revisões" },
      { href: "/admin/aprovacoes", ico: "✓", label: "Aprovações" },
    ],
  },
  {
    head: "Dados",
    items: [
      { href: "/admin/performance", ico: "▤", label: "Performance" },
      { href: "/admin/documentos", ico: "▦", label: "Informações" },
    ],
  },
];

// Every /admin/* section route; used so the "Clientes" (/admin) item does not
// stay highlighted when a more specific section is active.
const ALL_HREFS = [...NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href)), "/admin/configuracoes"];
const SECTION_HREFS = ALL_HREFS.filter((h) => h !== "/admin");

// Mock data for the notifications dropdown — a real backend/track is being
// built in parallel; swap this constant out for that data source once it
// lands. Keep it isolated here so the swap is a one-line change.
type MockNotification = { id: string; text: string; time: string };
const MOCK_NOTIFICATIONS: MockNotification[] = [
  { id: "1", text: 'Tarefa "Revisar copy" está próxima do prazo', time: "há 12 min" },
  { id: "2", text: "Pedro enviou uma tarefa para revisão", time: "há 1 h" },
  { id: "3", text: "Cliente aprovou o Plano de Ação", time: "há 3 h" },
  { id: "4", text: 'Novo comentário em "Campanha Agosto"', time: "ontem" },
];

export default function AdminShell({
  email,
  name,
  initials,
  userId,
  revisoesTabVisible,
  aprovacoesTabVisible,
  children,
}: {
  email: string;
  name: string;
  initials: string;
  userId: string;
  revisoesTabVisible: boolean;
  aprovacoesTabVisible: boolean;
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
  const [notifOpen, setNotifOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

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

  // close the notifications panel on outside click / Escape (mirrors the
  // account panel behavior above)
  useEffect(() => {
    if (!notifOpen) return;
    function onDown(event: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setNotifOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setNotifOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [notifOpen]);

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
        <div className="admin-sidebar-content">
          <div className="admin-topline">
            <Link href="/admin/plano" className="admin-brand">
              <span className="admin-mark">N</span>
              <span className="admin-word">NORTH</span>
              <span className="admin-role">admin</span>
            </Link>
            <div className="admin-topline-actions">
              <div className="admin-notif" ref={notifRef}>
                <button
                  type="button"
                  className="admin-icon-btn"
                  onClick={() => setNotifOpen((open) => !open)}
                  aria-haspopup="menu"
                  aria-expanded={notifOpen}
                  aria-label="Notificações"
                  title="Notificações"
                >
                  🔔
                  {MOCK_NOTIFICATIONS.length > 0 ? <span className="admin-notif-dot" aria-hidden /> : null}
                </button>

                {notifOpen ? (
                  <div className="admin-notif-panel" role="menu">
                    <p className="admin-notif-head">Notificações</p>
                    {MOCK_NOTIFICATIONS.length > 0 ? (
                      MOCK_NOTIFICATIONS.map((notif) => (
                        <div className="admin-notif-item" key={notif.id} role="menuitem">
                          <span className="admin-notif-text">{notif.text}</span>
                          <span className="admin-notif-time">{notif.time}</span>
                        </div>
                      ))
                    ) : (
                      <p className="admin-notif-empty">Nenhuma notificação por aqui.</p>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {NAV_GROUPS.map((group) => {
            const items = group.items.filter((item) => {
              if (item.href === "/admin/revisoes") return revisoesTabVisible;
              if (item.href === "/admin/aprovacoes") return aprovacoesTabVisible;
              return true;
            });
            if (items.length === 0) return null;
            return (
              <div className="admin-nav-group" key={group.head}>
                <p className="admin-nav-head">{group.head}</p>
                {items.map((item) => (
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
            );
          })}

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
                  <button
                    type="button"
                    className="admin-account-item admin-account-theme"
                    role="menuitem"
                    onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
                  >
                    <span className="admin-account-ico" aria-hidden>
                      {theme === "light" ? "☾" : "☀"}
                    </span>
                    {theme === "light" ? "Modo escuro" : "Modo claro"}
                  </button>
                  <Link className="admin-account-item" href="/admin/configuracoes" role="menuitem" onClick={() => setAccountOpen(false)}>
                    <span className="admin-account-ico" aria-hidden>
                      ⚙
                    </span>
                    Configurações
                  </Link>
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
        </div>
      </aside>

      <main className="admin-main">
        <CurrentUserProvider user={{ name, email, initials, userId }}>{children}</CurrentUserProvider>
      </main>
    </div>
  );
}
