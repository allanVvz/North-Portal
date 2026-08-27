"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import BrandLockup from "../brand/BrandLockup";
import { CurrentUserProvider } from "./CurrentUserContext";
import NotificationsList from "./NotificationsList";
import { useNotificationsRealtime } from "@/lib/useNotificationsRealtime";
import type { NotificationRecord } from "@/lib/notificationTypes";

type Theme = "light" | "dark";

// Line-icon set in the Lucide/Feather stroke convention (24x24, round caps/
// joins, fill:none) — picked per nav item for recognizability rather than
// the previous generic Unicode glyphs (◎ ◈ ▤ …, several duplicated).
type IconName =
  | "home"
  | "users"
  | "target"
  | "listChecks"
  | "eye"
  | "checkCircle"
  | "barChart"
  | "fileText"
  | "bot"
  | "bell"
  | "moon"
  | "sun"
  | "settings"
  | "logOut"
  | "chevronDown";

const ICON_PATHS: Record<IconName, React.ReactNode> = {
  home: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
    </>
  ),
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  listChecks: (
    <>
      <path d="m3 6 1.5 1.5L7 5" />
      <path d="m3 13 1.5 1.5L7 12" />
      <path d="M11 6h10" />
      <path d="M11 13h10" />
      <path d="M11 20h10" />
      <path d="m3 19.5 1.5 1.5L7 18.5" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.4-7 10-7 10 7 10 7-3.4 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  checkCircle: (
    <>
      <path d="M21.8 10.5A10 10 0 1 1 17 3.4" />
      <path d="m9 11 3 3L22 4" />
    </>
  ),
  barChart: (
    <>
      <line x1="5" y1="20" x2="5" y2="14" />
      <line x1="12" y1="20" x2="12" y2="6" />
      <line x1="19" y1="20" x2="19" y2="10" />
    </>
  ),
  fileText: (
    <>
      <path d="M14 2.5H7a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2.5V8h5.5" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="15" y2="17" />
    </>
  ),
  bot: (
    <>
      <path d="M12 8V4H8" />
      <rect x="4" y="8" width="16" height="12" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <circle cx="9" cy="13" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="13" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </>
  ),
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.4M12 19.1v2.4M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H2.6a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.2 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H8.6a1.65 1.65 0 0 0 1-1.51V2.6a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V8.6a1.65 1.65 0 0 0 1.51 1h.09a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </>
  ),
  logOut: (
    <>
      <path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3" />
      <polyline points="15 17 20 12 15 7" />
      <line x1="20" y1="12" x2="8" y2="12" />
    </>
  ),
  chevronDown: <polyline points="6 9 12 15 18 9" />,
};

function Icon({ name, size = 17 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

const NAV_ITEMS: { href: string; ico: IconName; label: string }[] = [
  { href: "/admin/home", ico: "home", label: "Início" },
  { href: "/admin/clientes", ico: "users", label: "Clientes" },
  // Tarefas, Rotinas e Plano de Ação vivem numa tela só (/admin/operacao),
  // com a seleção na linha superior — por isso o item é "Operação", não
  // "Tarefas": Tarefas é uma das três abas de dentro.
  { href: "/admin/operacao", ico: "listChecks", label: "Operação" },
  { href: "/admin/revisoes", ico: "eye", label: "Revisões" },
  { href: "/admin/aprovacoes", ico: "checkCircle", label: "Aprovações" },
  { href: "/admin/performance", ico: "barChart", label: "Performance" },
  { href: "/admin/documentos", ico: "fileText", label: "Informações" },
  { href: "/admin/automacoes", ico: "bot", label: "Automações" },
];

// Every /admin/* section route; used so the "Clientes" (/admin) item does not
// stay highlighted when a more specific section is active.
// Telas /admin/* que existem fora do menu — sem elas na lista, isActive() as
// trataria como "Clientes" e deixaria o item errado destacado.
const SECTION_HREFS = [...NAV_ITEMS.map((i) => i.href), "/admin/configuracoes", "/admin/notificacoes"];

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
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const accountRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const unreadCount = notifications.filter((n) => !n.read_at).length;

  const refetchNotifications = useCallback(() => {
    fetch("/api/admin/notifications")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { notifications: NotificationRecord[] } | null) => {
        if (data) setNotifications(data.notifications);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refetchNotifications();
  }, [refetchNotifications]);
  useNotificationsRealtime(userId, refetchNotifications);

  // opening the bell marks the whole inbox read (optimistic locally, fire-
  // and-forget PATCH) — same "read on view" idiom as a typical inbox
  useEffect(() => {
    if (!notifOpen || unreadCount === 0) return;
    setNotifications((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })));
    fetch("/api/admin/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifOpen]);

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
    if (pathname === href || pathname.startsWith(`${href}/`)) return true;
    // Clientes also owns the screens that hang off a client: /admin/novo and
    // /admin/<slug> (editor and visão). Those aren't nav entries of their own,
    // so they'd otherwise leave the sidebar with nothing highlighted.
    if (href === "/admin/clientes") {
      if (SECTION_HREFS.some((h) => pathname === h || pathname.startsWith(`${h}/`))) return false;
      return pathname.startsWith("/admin/");
    }
    return false;
  }

  return (
    <div className="admin-shell" data-theme={theme} suppressHydrationWarning>
      <aside className="admin-sidebar">
        <div className="admin-sidebar-content">
          <div className="admin-topline">
            <Link href="/admin/plano" className="admin-brand">
              <BrandLockup variant="admin" />
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
                  <Icon name="bell" size={16} />
                  {unreadCount > 0 ? <span className="admin-notif-dot" aria-hidden /> : null}
                </button>

                {notifOpen ? (
                  <div className="admin-notif-panel" role="menu">
                    <p className="admin-notif-head">Notificações</p>
                    <NotificationsList notifications={notifications} />
                    <Link className="admin-notif-all" href="/admin/notificacoes" onClick={() => setNotifOpen(false)}>
                      Ver todas →
                    </Link>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="admin-nav-group">
            {NAV_ITEMS.filter((item) => {
              if (item.href === "/admin/revisoes") return revisoesTabVisible;
              if (item.href === "/admin/aprovacoes") return aprovacoesTabVisible;
              return true;
            }).map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`admin-nav-item ${isActive(item.href) ? "active" : ""}`}
              >
                <span className="admin-nav-ico">
                  <Icon name={item.ico} />
                </span>
                <span className="admin-nav-label">{item.label}</span>
              </Link>
            ))}
          </div>

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
                      <Icon name={theme === "light" ? "moon" : "sun"} size={15} />
                    </span>
                    {theme === "light" ? "Modo escuro" : "Modo claro"}
                  </button>
                  <Link className="admin-account-item" href="/admin/configuracoes" role="menuitem" onClick={() => setAccountOpen(false)}>
                    <span className="admin-account-ico" aria-hidden>
                      <Icon name="settings" size={15} />
                    </span>
                    Configurações
                  </Link>
                  <a className="admin-account-item" href="/logout" role="menuitem">
                    <span className="admin-account-ico" aria-hidden>
                      <Icon name="logOut" size={15} />
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
                  <Icon name="chevronDown" size={14} />
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
