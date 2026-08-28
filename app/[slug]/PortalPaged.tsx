"use client";

import "./portal.css";
import CompassMark from "../brand/CompassMark";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import CommentText from "@/app/CommentText";
import { commentsOf, extractLatestLink, formatCommentTime } from "@/lib/comments";
import { ACCESS_PLATFORMS, type ClientTask, type CredentialSummary, type DocumentRecord, type PortalPayload, type PortalPrefs } from "@/lib/validation";
import { fileTypeLabel, formatFileSize } from "@/lib/documentFiles";
import DocumentFilePreview from "@/app/DocumentFilePreview";
import { useTaskRealtime } from "@/lib/useTaskRealtime";
import { briefSteps, folders } from "./content";
import ManualDoCliente from "./ManualDoCliente";
import { kindLabel, kindTone, taskProgress, checkpointsProgress } from "@/lib/taskCatalog";
import { AVATAR_STYLES, briefingNav, defaultContent, type Tone } from "./portalData";

type SaveChip = "" | "Salvando..." | "Salvo" | "Erro ao salvar" | "Concluido";
type PageId =
  | "inicio"
  | "jornada"
  | "briefing"
  | "central"
  | "acessos"
  | "feedbacks"
  | "plano-acao"
  | "time-north"
  | "trilhas"
  | "documentos"
  | "agenda"
  | "dashboard"
  | "config";
type NavGroup = "inicio" | "cliente" | "operacao" | "north" | "resultados";

type NavItem = { label: string; sub?: string; page: PageId; group: NavGroup; dir: string };
type NavCluster = { label: string; group: NavGroup; page: PageId; blurb: string; cardinal: string; items: NavItem[] };

const DIR_DEG: Record<string, number> = {
  N: 0, NNE: 22.5, NE: 45, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, O: 270, W: 270, NW: 315, NNW: 337.5,
};

// Bússola: 4 territórios com direção própria (mais "Início", fora do esquema
// cardinal N/L/S/O — ver BigCompass) + microcopy de cada um, usada tanto no
// MegaDropdown quanto no Overlay de tela cheia.
const NAV: NavCluster[] = [
  {
    label: "Início", group: "inicio", page: "inicio", blurb: "Sua visão geral.", cardinal: "O",
    items: [{ label: "Visão geral", sub: "Resumo da jornada e pendências", page: "inicio", group: "inicio", dir: "O" }],
  },
  {
    label: "Cliente", group: "cliente", page: "jornada",
    blurb: "Prepare sua base: pendências, briefing e acessos.", cardinal: "S",
    items: [
      { label: "Jornada", sub: "Pendências, briefing e itens obrigatórios", page: "jornada", group: "cliente", dir: "S" },
      { label: "Briefing", sub: "Conte sobre o seu negócio", page: "briefing", group: "cliente", dir: "SSW" },
      { label: "Acessos & Pastas", sub: "Pastas e acessos", page: "acessos", group: "cliente", dir: "SE" },
    ],
  },
  {
    label: "Operação", group: "operacao", page: "agenda",
    blurb: "Acompanhe encontros, aprovações e próximos movimentos.", cardinal: "L",
    items: [
      { label: "Agenda", sub: "Reuniões e marcos", page: "agenda", group: "operacao", dir: "E" },
      { label: "Feedbacks", sub: "Aprove entregas", page: "feedbacks", group: "operacao", dir: "NE" },
      { label: "Plano de Ação", sub: "Próximos 30 dias", page: "plano-acao", group: "operacao", dir: "ESE" },
    ],
  },
  {
    label: "North", group: "north", page: "time-north",
    blurb: "Seu norte: time, materiais, documentos e relação com a agência.", cardinal: "N",
    items: [
      { label: "Time North", sub: "Quem cuida de você", page: "time-north", group: "north", dir: "N" },
      { label: "Trilhas North", sub: "Central educacional", page: "trilhas", group: "north", dir: "NNE" },
      { label: "Documentos", sub: "Contratos e relatórios", page: "documentos", group: "north", dir: "NW" },
      { label: "Central Comercial", sub: "Contrato, plano e cobrança", page: "central", group: "north", dir: "NNW" },
    ],
  },
  {
    label: "Resultados", group: "resultados", page: "dashboard",
    blurb: "Veja sua evolução em números.", cardinal: "O",
    items: [
      { label: "Dashboard", sub: "Números consolidados", page: "dashboard", group: "resultados", dir: "W" },
    ],
  },
];

const ALL_ITEMS = NAV.flatMap((c) => c.items);
const PAGE_GROUP: Record<PageId, NavGroup> = {
  inicio: "inicio", jornada: "cliente", briefing: "cliente", acessos: "cliente",
  agenda: "operacao", feedbacks: "operacao", "plano-acao": "operacao",
  "time-north": "north", trilhas: "north", documentos: "north", central: "north",
  dashboard: "resultados", config: "inicio",
};
const PAGE_DIR: Record<PageId, string> = {
  inicio: "O", jornada: "S", briefing: "SSW", acessos: "SE",
  agenda: "E", feedbacks: "NE", "plano-acao": "ESE",
  "time-north": "N", trilhas: "NNE", documentos: "NW", central: "NNW",
  dashboard: "W", config: "N",
};
const PAGE_IDS = new Set<PageId>(Object.keys(PAGE_GROUP) as PageId[]);

// Screens still being validated with the team — locked in any built/deployed
// environment (Vercel preview or prod both set NODE_ENV=production), fully
// open when running `next dev` locally. Client portal only — admin unaffected.
const IS_DEV_BUILD = process.env.NODE_ENV !== "production";
const LOCKED_IN_PROD: PageId[] = ["acessos", "dashboard", "time-north"];
function isPageLocked(page: PageId): boolean {
  return !IS_DEV_BUILD && LOCKED_IN_PROD.includes(page);
}

// Per-client Revisão/Aprovação flags (client_flow_flags) hide "feedbacks" —
// unlike LOCKED_IN_PROD this is per-client server data, not a build-time
// constant, so it's updated whenever a fresh payload loads rather than
// computed inline. `revisaoCliente` has no client-facing page to hide today
// (there is no client "Revisão" screen), kept for schema symmetry.
let hiddenPagesForClient = new Set<PageId>();
function updateHiddenPagesForClient(flowFlags: PortalPayload["flowFlags"] | undefined) {
  const next = new Set<PageId>();
  if (flowFlags && !flowFlags.aprovacaoCliente) next.add("feedbacks");
  hiddenPagesForClient = next;
}
function isPageHiddenForClient(page: PageId): boolean {
  return hiddenPagesForClient.has(page);
}
// A cluster's own top-nav destination may itself be locked (e.g. "North" ->
// time-north) while the cluster still has other open items (Trilhas,
// Documentos...) — route the top-level click to the first open item instead
// of silently no-oping. Only a cluster with *no* open items stays locked.
function firstOpenPage(cluster: NavCluster): PageId {
  if (!isPageLocked(cluster.page) && !isPageHiddenForClient(cluster.page)) return cluster.page;
  return cluster.items.find((it) => !isPageLocked(it.page) && !isPageHiddenForClient(it.page))?.page ?? cluster.page;
}

function pageFromHash(): PageId {
  if (typeof window === "undefined") return "inicio";
  const h = window.location.hash.replace("#", "") as PageId;
  return PAGE_IDS.has(h) && !isPageLocked(h) && !isPageHiddenForClient(h) ? h : "inicio";
}
const hrefFor = (p: PageId) => (p === "inicio" ? "#" : `#${p}`);
const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "N";

export default function ClientPortalPaged() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const [payload, setPayload] = useState<PortalPayload | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [chip, setChip] = useState<SaveChip>("");
  const [pageError, setPageError] = useState("");
  const [activePage, setActivePage] = useState<PageId>("inicio");
  const [openMenu, setOpenMenu] = useState<NavGroup | null>(null);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [activeDir, setActiveDir] = useState("O");
  const [briefStep, setBriefStep] = useState(0);
  // Starts "light" (matches the server render). A lazy localStorage-read
  // initializer was tried and reverted: it diverges from the server-rendered
  // value, which Next.js flags as a hydration mismatch (tree gets discarded
  // and regenerated client-side) — worse than the brief flash it aimed to
  // avoid. Instead, a post-mount effect below applies the last confirmed
  // theme (cached client-side) as soon as possible, ahead of the
  // /api/client/[slug] round-trip that ultimately confirms client_prefs.theme.
  const [theme, setTheme] = useState<PortalPrefs["theme"]>("light");
  const [prefs, setPrefs] = useState<PortalPrefs | null>(null);

  const loaded = useRef(false);
  const saveSeq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);

  // Apply the cached theme right after mount — ahead of the /api/client/[slug]
  // fetch below, which can take a moment and would otherwise hold the UI in
  // "light" for that whole round-trip.
  useEffect(() => {
    const cached = window.localStorage.getItem("north-portal-theme");
    if (cached === "dark" || cached === "light") setTheme(cached);
  }, []);

  useEffect(() => {
    const sync = () => {
      const next = pageFromHash();
      setActivePage(next);
      setActiveDir(PAGE_DIR[next]);
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    };
    sync();
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpenMenu(null); setOverlayOpen(false); }
    };
    const onPointer = (e: PointerEvent) => {
      if (!headerRef.current?.contains(e.target as Node)) setOpenMenu(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, []);

  // `overflow:hidden` alone on body does not reliably block wheel-scroll
  // chaining to the page underneath the full-screen overlay (confirmed: the
  // background kept scrolling behind it). Locking via `position:fixed` with
  // the current offset pins the body in place regardless, and the offset is
  // restored on close so the page doesn't jump.
  useEffect(() => {
    if (!overlayOpen) return;
    const scrollY = window.scrollY;
    const body = document.body;
    body.classList.add("np-menu-open");
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    return () => {
      body.classList.remove("np-menu-open");
      body.style.position = "";
      body.style.top = "";
      body.style.left = "";
      body.style.right = "";
      window.scrollTo(0, scrollY);
    };
  }, [overlayOpen]);

  // apply theme to <html> so the page background matches
  useEffect(() => {
    document.documentElement.setAttribute("data-portal-theme", theme);
    return () => document.documentElement.removeAttribute("data-portal-theme");
  }, [theme]);

  // `quiet` skips the reset-to-null/loading flicker — used for the realtime
  // background refresh below, which should just swap in fresh data.
  const fetchPayload = useCallback((opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) {
      loaded.current = false;
      abortRef.current?.abort();
      setPageError("");
      setPayload(null);
      setChip("");
      updateHiddenPagesForClient(undefined);
    }
    return fetch(`/api/client/${slug}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          if (res.status === 404) throw new Error("Cliente nao encontrado ou inativo.");
          return null;
        }
        return res.json() as Promise<PortalPayload>;
      })
      .then((data) => {
        if (!data) { loaded.current = true; return; }
        setPayload(data);
        updateHiddenPagesForClient(data.flowFlags);
        setAnswers(data.briefing.answers ?? {});
        setChip(data.briefing.submitted ? "Concluido" : "");
        setPrefs(data.prefs);
        setTheme(data.prefs.theme);
        window.localStorage.setItem("north-portal-theme", data.prefs.theme);
        loaded.current = true;
      })
      .catch((err: Error) => {
        if (err.message.includes("Cliente")) setPageError(err.message);
        loaded.current = true;
      });
  }, [slug]);

  useEffect(() => {
    void fetchPayload();
  }, [fetchPayload]);

  // Keeps the Feedbacks queue (and anything else driven by tasks) in sync
  // with the admin Kanban without a manual refresh.
  const refreshQuiet = useCallback(() => { void fetchPayload({ quiet: true }); }, [fetchPayload]);
  useTaskRealtime(refreshQuiet);

  // autosave briefing answers (debounced)
  useEffect(() => {
    if (!loaded.current) return;
    const seq = ++saveSeq.current;
    const timer = window.setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setChip("Salvando...");
      try {
        const res = await fetch(`/api/client/${slug}/briefing`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answers, submitted: payload?.briefing.submitted ?? false }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("save failed");
        const saved = await res.json();
        if (seq === saveSeq.current) {
          setPayload((cur) => (cur ? { ...cur, briefing: saved } : cur));
          setChip(saved.submitted ? "Concluido" : "Salvo");
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError" && seq === saveSeq.current) setChip("Erro ao salvar");
      }
    }, 950);
    return () => window.clearTimeout(timer);
  }, [answers, payload?.briefing.submitted, slug]);

  const goTo = useCallback((page: PageId) => {
    // Single choke point — every nav path (top bar, dropdown, overlay, the
    // compass wheel itself) routes through here, so this is what actually
    // makes a locked page unreachable, not just visually hidden.
    if (isPageLocked(page) || isPageHiddenForClient(page)) return;
    setTransitioning(true);
    setActiveDir(PAGE_DIR[page]);
    setOpenMenu(null);
    window.setTimeout(() => {
      setActivePage(page);
      if (page === "briefing") setBriefStep(0);
      window.history.pushState(null, "", hrefFor(page));
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      setOverlayOpen(false);
      window.setTimeout(() => setTransitioning(false), 240);
    }, 260);
  }, []);

  const finishBriefing = useCallback(async () => {
    setChip("Salvando...");
    try {
      const res = await fetch(`/api/client/${slug}/briefing`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers, submitted: true }),
      });
      if (!res.ok) throw new Error("save failed");
      const saved = await res.json();
      setPayload((cur) => (cur ? { ...cur, briefing: saved } : cur));
      setChip("Concluido");
    } catch { setChip("Erro ao salvar"); }
  }, [answers, slug]);

  const setAnswer = useCallback((key: string, value: string) => {
    setAnswers((cur) => ({ ...cur, [key]: value }));
  }, []);

  const savePrefs = useCallback(async (patch: Partial<PortalPrefs>) => {
    setPrefs((cur) => (cur ? { ...cur, ...patch } : cur));
    try {
      await fetch(`/api/client/${slug}/prefs`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    } catch { /* best-effort */ }
  }, [slug]);

  const toggleTheme = useCallback((next: PortalPrefs["theme"]) => {
    setTheme(next);
    window.localStorage.setItem("north-portal-theme", next);
    void savePrefs({ theme: next });
  }, [savePrefs]);

  // Stable identity — ManualDoCliente depends on this in a useEffect; an
  // inline arrow here would get a new identity every render and loop forever.
  const onManualFinish = useCallback(() => void savePrefs({ manualSeen: true }), [savePrefs]);

  const onDocumentRead = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/client/${slug}/documents/${id}`, { method: "PATCH" });
      if (!res.ok) return;
      const updated = (await res.json()) as DocumentRecord;
      setPayload((cur) => (cur ? { ...cur, documents: (cur.documents ?? []).map((d) => (d.id === id ? updated : d)) } : cur));
    } catch { /* best-effort */ }
  }, [slug]);

  const onCredentialSave = useCallback(async (input: { platform: string; username: string; password?: string; notes?: string }) => {
    const res = await fetch(`/api/client/${slug}/credentials`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error("save-failed");
    const updated = (await res.json()) as CredentialSummary;
    setPayload((cur) => (cur ? { ...cur, credentials: (cur.credentials ?? []).map((c) => (c.platform === updated.platform ? updated : c)) } : cur));
  }, [slug]);

  const content = payload?.content ?? defaultContent;
  const name = prefs?.displayName || payload?.client.name || slug;
  const links = payload?.driveLinks;
  const briefingDone = Boolean(payload?.briefing.submitted);
  const manualDone = Boolean(prefs?.manualSeen);
  const documents = payload?.documents ?? [];
  const hasDocuments = documents.length > 0;
  const documentsRead = hasDocuments && documents.every((d) => d.read_at);
  const credentials = payload?.credentials ?? [];
  const hasDriveLink = Boolean(links?.brandUrl || links?.productsUrl || links?.uploadsUrl);
  const accessDone = hasDriveLink && credentials.length > 0 && credentials.every((c) => c.username.trim() && c.hasPassword);
  const avatarStyle = prefs?.avatarStyle ?? 0;
  const activeGroup = PAGE_GROUP[activePage];

  if (pageError) {
    return (
      <div className="np" data-theme={theme} suppressHydrationWarning>
        <main className="np-fatal">
          <span className="np-eyebrow">Portal North</span>
          <h1>Portal indisponível.</h1>
          <p>{pageError}</p>
        </main>
      </div>
    );
  }

  const ctx: PageCtx = {
    content, links, name, slug, briefingDone, manualDone, goTo, payload, onManualFinish,
    hasDocuments, documentsRead, onDocumentRead,
    credentials, accessDone, onCredentialSave,
  };
  const cafeMode = activePage === "briefing" && briefStep === 0;

  return (
    <div className="np" data-theme={theme} suppressHydrationWarning>
      {!cafeMode && (
        <>
          <Header
            refEl={headerRef}
            activeGroup={activeGroup}
            activePage={activePage}
            openMenu={openMenu}
            setOpenMenu={setOpenMenu}
            onGo={goTo}
            onOverlay={() => setOverlayOpen(true)}
            theme={theme}
            onTheme={toggleTheme}
            avatarStyle={avatarStyle}
            avatarInitials={initials(name)}
          />
          <Overlay
            open={overlayOpen}
            activeDir={activeDir}
            activeGroup={activeGroup}
            activePage={activePage}
            onClose={() => setOverlayOpen(false)}
            onGo={goTo}
          />
        </>
      )}
      <div className={`np-veil ${transitioning ? "show" : ""}`} aria-hidden />

      {activePage === "briefing" ? (
        <BriefingPage
          step={briefStep}
          setStep={setBriefStep}
          answers={answers}
          onAnswer={setAnswer}
          onFinish={finishBriefing}
          chip={chip}
          onGo={goTo}
        />
      ) : (
        <main className="np-shell">
          {activePage === "inicio" && <HomePage ctx={ctx} />}
          {activePage === "jornada" && <PendenciasPage ctx={ctx} />}
          {activePage === "central" && <CentralPage ctx={ctx} />}
          {activePage === "acessos" && <AcessosPage ctx={ctx} />}
          {activePage === "feedbacks" && (
            <EntregasPage
              ctx={ctx}
              pending={payload?.pendingApprovals ?? []}
              resolved={payload?.resolvedApprovals ?? []}
              sessionUserId={payload?.sessionUserId ?? null}
              sessionLevel={payload?.sessionLevel ?? null}
              onActed={refreshQuiet}
            />
          )}
          {activePage === "documentos" && <DocumentosPage ctx={ctx} documents={payload?.documents} />}
          {activePage === "time-north" && <TimePage ctx={ctx} />}
          {activePage === "trilhas" && <TrilhasPage ctx={ctx} />}
          {activePage === "agenda" && <AgendaPage ctx={ctx} />}
          {activePage === "plano-acao" && <PlanoPage ctx={ctx} />}
          {activePage === "dashboard" && <DashboardPage ctx={ctx} results={payload?.results} />}
          {activePage === "config" && (
            <ConfigPage
              ctx={ctx}
              theme={theme}
              onTheme={toggleTheme}
              prefs={prefs}
              avatarStyle={avatarStyle}
              onSave={savePrefs}
            />
          )}
          <Footer />
        </main>
      )}
    </div>
  );
}

type PageCtx = {
  content: typeof defaultContent;
  links: PortalPayload["driveLinks"] | undefined;
  name: string;
  slug: string;
  briefingDone: boolean;
  // Real, server-tracked Manual do Cliente completion (client_prefs.manual_seen).
  manualDone: boolean;
  goTo: (p: PageId) => void;
  payload: PortalPayload | null;
  onManualFinish: () => void;
  // Real Documentos read-tracking, driving the "Ler documentos" Jornada item.
  hasDocuments: boolean;
  documentsRead: boolean;
  onDocumentRead: (id: string) => void;
  // Real Acessos & Pastas credential storage.
  credentials: CredentialSummary[];
  accessDone: boolean;
  onCredentialSave: (input: { platform: string; username: string; password?: string; notes?: string }) => Promise<void>;
};

/* ============================= Header ============================= */

function Header(props: {
  refEl: React.MutableRefObject<HTMLElement | null>;
  activeGroup: NavGroup;
  activePage: PageId;
  openMenu: NavGroup | null;
  setOpenMenu: (g: NavGroup | null) => void;
  onGo: (p: PageId) => void;
  onOverlay: () => void;
  theme: PortalPrefs["theme"];
  onTheme: (t: PortalPrefs["theme"]) => void;
  avatarStyle: number;
  avatarInitials: string;
}) {
  return (
    <header className="np-header" ref={props.refEl}>
      <div className="np-brand-zone">
        <button className="np-wordmark" onClick={() => props.onGo("inicio")}>
          <span className="np-logo-dot" aria-hidden><CompassMark size={22} /></span>
          <strong>NORTH</strong>
          <em>PORTAL</em>
        </button>
        {IS_DEV_BUILD && (
          <button className="np-menu-btn" aria-label="Abrir bússola" onClick={props.onOverlay}>
            <Ico name="menu" />
          </button>
        )}
      </div>

      <nav className="np-nav" aria-label="Navegação principal">
        {NAV.map((cluster) => {
          const target = firstOpenPage(cluster);
          const clusterLocked = isPageLocked(target);
          return (
            <div
              key={cluster.group}
              className="np-nav-item"
              onMouseEnter={() => props.setOpenMenu(cluster.group)}
              onMouseLeave={() => props.setOpenMenu(null)}
            >
              <button
                className={`${props.activeGroup === cluster.group ? "active" : ""} ${clusterLocked ? "locked" : ""}`}
                onClick={() => !clusterLocked && props.onGo(target)}
                aria-current={props.activeGroup === cluster.group ? "page" : undefined}
                aria-disabled={clusterLocked}
              >
                {cluster.label}
                {clusterLocked && <Ico name="lock" />}
              </button>
              {cluster.items.length > 1 && (
                <MegaDropdown open={props.openMenu === cluster.group} cluster={cluster} onGo={props.onGo} />
              )}
            </div>
          );
        })}
      </nav>

      <div className="np-header-actions">
        <button
          className="np-theme-toggle"
          aria-label={props.theme === "dark" ? "Tema claro" : "Tema escuro"}
          onClick={() => props.onTheme(props.theme === "dark" ? "light" : "dark")}
        >
          <Ico name={props.theme === "dark" ? "sun" : "moon"} />
        </button>
        <button
          className="np-avatar"
          style={{ background: AVATAR_STYLES[props.avatarStyle] }}
          onClick={() => props.onGo("config")}
          aria-label="Configurações"
        >
          {props.avatarInitials}
        </button>
      </div>
    </header>
  );
}

function MegaDropdown(props: { open: boolean; cluster: NavCluster; onGo: (p: PageId) => void }) {
  const c = props.cluster;
  const isNorth = c.group === "north";
  return (
    <div className={`np-dropdown ${props.open ? "open" : ""}`}>
      <div className={`np-dropdown-inner ${isNorth ? "np-dropdown-north" : ""}`}>
        <div className="np-dd-list">
          <span className="np-eyebrow np-dd-eyebrow">
            {isNorth && <span className="np-logo-dot sm" aria-hidden><CompassMark size={14} /></span>}
            {c.label} <em>· direção {cardinalName(c.cardinal)}</em>
          </span>
          <p className="np-dd-blurb">{c.blurb}</p>
          {c.items.filter((it) => !isPageHiddenForClient(it.page)).map((it) => {
            const locked = isPageLocked(it.page);
            return (
              <button
                key={it.page}
                className={`np-dd-row ${locked ? "locked" : ""}`}
                onClick={() => !locked && props.onGo(it.page)}
                aria-disabled={locked}
              >
                <span className="np-dd-dot" />
                <span className="np-dd-text">
                  <strong>{it.label}</strong>
                  <em>{it.sub}</em>
                </span>
                {locked ? <Ico name="lock" /> : <span className="np-dd-dir">{it.dir}</span>}
              </button>
            );
          })}
        </div>
        <div className="np-dd-compass">
          <MiniCompass dir={cardinalToDir(c.cardinal)} />
          <p>A agulha aponta para {c.label} ({cardinalName(c.cardinal)}).</p>
        </div>
      </div>
    </div>
  );
}

/* ============================= Overlay (full-screen bússola) ============================= */

type CompassLabel = { label: string; sub?: string };

/** Closest nav item to a given compass degree (circular distance). */
function nearestItem(deg: number, items: NavItem[]): NavItem {
  let best = items[0];
  let bestDist = Infinity;
  for (const it of items) {
    const d = DIR_DEG[it.dir] ?? 0;
    let diff = Math.abs(d - deg) % 360;
    if (diff > 180) diff = 360 - diff;
    if (diff < bestDist) { bestDist = diff; best = it; }
  }
  return best;
}

function Overlay(props: {
  open: boolean;
  activeDir: string;
  activeGroup: NavGroup;
  activePage: PageId;
  onClose: () => void;
  onGo: (p: PageId) => void;
}) {
  // Shared between the compass and the column links: whichever one the user
  // clicks, the needle locks onto that destination's cardinal degree and
  // eases there (~480ms) before the real navigation fires — see
  // DOCUMENTACAO-SIDEBAR-BUSSOLA.md "Animação da Bússola".
  const [lock, setLock] = useState<{ deg: number; page: PageId } | null>(null);
  const [hoverItem, setHoverItem] = useState<NavItem | null>(null);
  const lockingRef = useRef(false);

  const requestGo = useCallback((page: PageId) => {
    if (lockingRef.current) return;
    lockingRef.current = true;
    setHoverItem(null);
    setLock({ deg: DIR_DEG[PAGE_DIR[page]] ?? 0, page });
    window.setTimeout(() => {
      lockingRef.current = false;
      props.onGo(page);
      setLock(null);
    }, 480);
  }, [props.onGo]);

  // Defensive reset: guarantees a fresh dial (no stale lock/hover) each time
  // the overlay is reopened, regardless of how the previous session ended.
  useEffect(() => {
    if (props.open) { setLock(null); setHoverItem(null); lockingRef.current = false; }
  }, [props.open]);

  const activeItem = ALL_ITEMS.find((it) => it.page === props.activePage);
  const activeCluster = NAV.find((c) => c.group === props.activeGroup);
  const idleInfo: CompassLabel = activeItem ?? (activeCluster ? { label: activeCluster.label, sub: activeCluster.blurb } : { label: "Início" });
  const lockInfo: CompassLabel | undefined = lock ? ALL_ITEMS.find((it) => it.page === lock.page) : undefined;
  const displayInfo = lockInfo ?? hoverItem ?? idleInfo;

  return (
    <aside className={`np-overlay ${props.open ? "open" : ""}`} aria-hidden={!props.open}>
      <div className="np-overlay-top">
        <button className="np-wordmark" onClick={props.onClose}>
          <span className="np-logo-dot" aria-hidden><CompassMark size={22} /></span>
          <strong>north</strong>
          <em>PORTAL</em>
        </button>
        <button className="np-overlay-close" onClick={props.onClose}>Fechar <Ico name="close" /></button>
      </div>

      <div className="np-overlay-cols">
        {NAV.map((c) => (
          <div key={c.group} className={`np-ov-col ${c.group === "north" ? "np-ov-col-north" : ""} ${props.activeGroup === c.group ? "here" : ""}`}>
            <div className="np-ov-head">
              <span className="np-ov-cardinal">{c.cardinal}</span>
              <div>
                <strong>{c.label} {props.activeGroup === c.group && <span className="np-ov-here">AQUI</span>}</strong>
                <em>{cardinalName(c.cardinal).toUpperCase()}</em>
              </div>
            </div>
            <p className="np-ov-blurb">{c.blurb}</p>
            {c.items.filter((it) => !isPageHiddenForClient(it.page)).map((it) => {
              const locked = isPageLocked(it.page);
              return (
                <button
                  key={it.page}
                  className={`np-ov-link ${locked ? "locked" : ""}`}
                  onClick={() => !locked && requestGo(it.page)}
                  onMouseEnter={() => !lock && !locked && setHoverItem(it)}
                  onMouseLeave={() => !lock && setHoverItem(null)}
                  aria-disabled={locked}
                >
                  <span className="np-ov-link-text">
                    <strong>{it.label}</strong>
                    <em>{it.sub}</em>
                  </span>
                  {locked ? <Ico name="lock" /> : <><span className="np-ov-dir">{it.dir}</span><Ico name="arrow" /></>}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="np-overlay-compass">
        <span className="np-eyebrow">Escolha uma direção</span>
        <div className="np-overlay-info" aria-live="polite">
          <p className="np-overlay-info-title">{displayInfo.label}</p>
          <p className="np-overlay-info-desc">{displayInfo.sub ?? "A agulha segue você"}</p>
        </div>
        <BigCompass
          activeDir={props.activeDir}
          lockDeg={lock?.deg ?? null}
          externalDeg={!lock && hoverItem ? DIR_DEG[hoverItem.dir] ?? null : null}
          onHover={(it) => !lock && setHoverItem(it)}
          onPick={requestGo}
        />
      </div>

      <div className="np-overlay-foot">
        <span>MAIS:</span>
        <a href="/">Landing page</a>
        <a href="/planos">Planos</a>
        <a href="/como-funciona">Como funciona</a>
        <a href="/termos-de-uso">Termos de Uso</a>
        <a href="/politica-de-privacidade">Política de Privacidade</a>
      </div>
    </aside>
  );
}

/* ============================= Compass SVGs ============================= */

function compassPoint(deg: number, r: number, cx = 210, cy = 210) {
  const a = ((deg - 90) * Math.PI) / 180;
  return { x: +(cx + Math.cos(a) * r).toFixed(2), y: +(cy + Math.sin(a) * r).toFixed(2) };
}

function Compass(props: { activeDir: string; onGo: (p: PageId) => void; targets?: NavItem[] }) {
  const deg = DIR_DEG[props.activeDir] ?? 0;
  const targets = props.targets ?? ALL_ITEMS;
  return (
    <svg className="np-compass" viewBox="0 0 420 420" role="img" aria-label={`Bússola em ${props.activeDir}`}>
      <circle className="np-c-ring" cx="210" cy="210" r="188" />
      <circle className="np-c-ring soft" cx="210" cy="210" r="132" />
      <circle className="np-c-ring soft" cx="210" cy="210" r="76" />
      {(["N", "L", "S", "O"] as const).map((lbl) => {
        const d = { N: 0, L: 90, S: 180, O: 270 }[lbl];
        const p = compassPoint(d, 168);
        return <text key={lbl} className="np-c-label" x={p.x} y={p.y} dominantBaseline="middle" textAnchor="middle">{lbl}</text>;
      })}
      <g className="np-c-needle" style={{ transform: `rotate(${deg}deg)`, transformOrigin: "210px 210px" }}>
        <polygon className="np-needle-n" points="210,52 222,210 198,210" />
        <polygon className="np-needle-s" points="210,368 222,210 198,210" />
      </g>
      <circle className="np-c-hub" cx="210" cy="210" r="12" />
      {targets.map((it) => {
        const p = compassPoint(DIR_DEG[it.dir], 132);
        const active = it.dir === props.activeDir;
        return (
          <g key={`${it.page}-${it.dir}`} className={`np-c-target ${active ? "active" : ""}`}
             onClick={() => props.onGo(it.page)} role="button" tabIndex={0}
             onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && props.onGo(it.page)}
             aria-label={`${it.label} ${it.dir}`}>
            <circle cx={p.x} cy={p.y} r="6" />
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Full-screen compass. Two bits of automation drive the needle (documented
 * here and in DOCUMENTACAO-SIDEBAR-BUSSOLA.md "Animação da Bússola"):
 *
 *  1. Mouse-follow — while the pointer is over the dial, the needle tracks
 *     the cursor's angle from the dial's center in real time, with a very
 *     short linear transition (just enough to stay smooth at display refresh
 *     rate without visibly lagging behind the cursor). `onHover` reports the
 *     nearest destination so the caption above the dial can update live.
 *  2. Click-to-lock — clicking a cardinal (or, via `onPick`'s sibling
 *     `requestGo` in Overlay, any menu link) freezes the needle on that
 *     destination's exact degree and eases it there over ~480ms
 *     (cubic-bezier, matches the 420-560ms spec) before the route actually
 *     changes — the compass visibly "confirms" the destination first.
 *
 * `lockDeg` (non-null while a pick is animating) always wins over the live
 * pointer angle, which in turn wins over `externalDeg` (set when a menu link
 * outside the dial is hovered — see Overlay's `hoverItem` — so the needle
 * reacts to holding over any menu item, not just moving over the dial
 * itself); when none of those are active the needle idles on `activeDir`.
 * Whichever destination the needle currently reads gets a small pulsing
 * marker tangent to the outer ring at that degree, confirming there's a
 * real page in that direction.
 */
function BigCompass(props: {
  activeDir: string;
  lockDeg: number | null;
  externalDeg: number | null;
  onHover: (it: NavItem | null) => void;
  onPick: (page: PageId) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [pointerDeg, setPointerDeg] = useState<number | null>(null);
  const locking = props.lockDeg !== null;
  const idleDeg = DIR_DEG[props.activeDir] ?? 0;
  const deg = locking ? props.lockDeg! : pointerDeg ?? props.externalDeg ?? idleDeg;
  const showMark = locking || pointerDeg !== null || props.externalDeg !== null;

  function angleFromPointer(e: React.MouseEvent) {
    const rect = svgRef.current!.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const raw = (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI + 90;
    return (raw + 360) % 360;
  }
  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    if (locking) return;
    const a = angleFromPointer(e);
    setPointerDeg(a);
    props.onHover(nearestItem(a, ALL_ITEMS));
  }
  function onLeave() {
    if (locking) return;
    setPointerDeg(null);
    props.onHover(null);
  }

  const ticks = Array.from({ length: 24 }, (_, i) => i * 15);
  const needleTransition = locking
    ? "transform .48s cubic-bezier(.22,1,.36,1)"
    : pointerDeg !== null
      ? "transform .05s linear"
      : "transform .3s ease";
  const markPoint = showMark ? compassPoint(deg, 205, 230, 230) : null;

  return (
    <svg
      ref={svgRef} className="np-bigcompass" viewBox="0 0 460 460" role="img" aria-label="Bússola de navegação — a agulha segue o ponteiro do mouse"
      onMouseMove={onMove} onMouseLeave={onLeave}
    >
      <circle className="np-c-ring" cx="230" cy="230" r="205" />
      <circle className="np-c-ring soft" cx="230" cy="230" r="150" />
      <circle className="np-c-ring soft" cx="230" cy="230" r="92" />
      {ticks.map((t) => {
        const o = compassPoint(t, 205, 230, 230);
        const i = compassPoint(t, t % 90 === 0 ? 190 : 197, 230, 230);
        return <line key={t} className="np-c-tick" x1={o.x} y1={o.y} x2={i.x} y2={i.y} />;
      })}
      {([["N", 0, "NORTH", "north"], ["L", 90, "OPERAÇÃO", "operacao"], ["S", 180, "CLIENTE", "cliente"], ["O", 270, "RESULTADOS", "resultados"]] as const).map(
        ([lbl, d, sub, grp]) => {
          const p = compassPoint(d, 225, 230, 230);
          const cluster = NAV.find((c) => c.group === grp)!;
          return (
            <g
              key={lbl} className="np-bc-cardinal" role="button" tabIndex={0}
              onClick={() => props.onPick(cluster.page)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && props.onPick(cluster.page)}
              onMouseEnter={() => !locking && props.onHover(cluster.items[0])}
            >
              <text className="np-bc-letter" x={p.x} y={p.y - 4} textAnchor="middle">{lbl}</text>
              <text className="np-bc-sub" x={p.x} y={p.y + 14} textAnchor="middle">{sub}</text>
            </g>
          );
        }
      )}
      <g className="np-c-needle" style={{ transform: `rotate(${deg}deg)`, transformOrigin: "230px 230px", transition: needleTransition }}>
        <polygon className="np-needle-n" points="230,68 244,230 216,230" />
        <polygon className="np-needle-s" points="230,392 244,230 216,230" />
      </g>
      <circle className="np-c-hub" cx="230" cy="230" r="14" />
      {markPoint ? (
        <g key={Math.round(deg)} className="np-bc-mark">
          <circle className="np-bc-mark-ring" cx={markPoint.x} cy={markPoint.y} r="9" />
          <circle className="np-bc-mark-dot" cx={markPoint.x} cy={markPoint.y} r="3.5" />
        </g>
      ) : null}
    </svg>
  );
}

function MiniCompass(props: { dir: string }) {
  const deg = DIR_DEG[props.dir] ?? 180;
  return (
    <svg className="np-minicompass" viewBox="0 0 220 220" role="img" aria-hidden>
      <circle className="np-c-ring" cx="110" cy="110" r="96" />
      <circle className="np-c-ring soft" cx="110" cy="110" r="60" />
      {([["N", 0], ["L", 90], ["S", 180], ["O", 270]] as const).map(([lbl, d]) => {
        const p = compassPoint(d, 84, 110, 110);
        return <text key={lbl} className="np-c-label" x={p.x} y={p.y} dominantBaseline="middle" textAnchor="middle">{lbl}</text>;
      })}
      {ALL_ITEMS.map((it) => {
        const p = compassPoint(DIR_DEG[it.dir], 60, 110, 110);
        return <circle key={`${it.page}-${it.dir}`} className={`np-mc-dot ${it.dir === props.dir ? "on" : ""}`} cx={p.x} cy={p.y} r="3.5" />;
      })}
      <g className="np-c-needle" style={{ transform: `rotate(${deg}deg)`, transformOrigin: "110px 110px" }}>
        <polygon className="np-needle-n" points="110,34 119,110 101,110" />
        <polygon className="np-needle-s" points="110,186 119,110 101,110" />
      </g>
      <circle className="np-c-hub" cx="110" cy="110" r="7" />
    </svg>
  );
}

function cardinalName(c: string) {
  return { N: "Norte", L: "Leste", S: "Sul", O: "Oeste" }[c] ?? c;
}
function cardinalToDir(c: string) {
  return { N: "N", L: "E", S: "S", O: "O" }[c] ?? "S";
}

/* ============================= Home ============================= */

// Real Home stats: onboarding % (checkpoint rollup), pending approvals count,
// next agenda event — same 3 concepts as before, now sourced from `payload`
// instead of static content, and never repeated below (see `homeFeed`).
function homeStats(props: { ctx: PageCtx }): { tone: Tone; value: string; unit: string; sub: string }[] {
  const { content, payload } = props.ctx;
  const h = content.home;
  const checkpoints = payload?.checkpoints ?? [];
  const onboardingPct = checkpoints.length ? checkpointsProgress(checkpoints) : null;
  const pendingCount = payload?.pendingApprovals.length ?? null;
  const nextEvent = content.agenda.next;
  const dateMatch = /(\d{2}) de (\p{L}+)/u.exec(nextEvent.when);
  const compactDate = dateMatch ? `${dateMatch[1]} ${dateMatch[2].slice(0, 3)}` : "";

  return [
    {
      tone: onboardingPct === null ? h.stats[0]?.tone ?? "green" : onboardingPct >= 100 ? "green" : "gold",
      value: onboardingPct !== null ? `${onboardingPct}%` : h.stats[0]?.value ?? "—",
      unit: "onboarding",
      sub: checkpoints.length
        ? `${checkpoints.filter((c) => taskProgress(c) >= 100).length}/${checkpoints.length} checkpoints concluídos`
        : h.stats[0]?.sub ?? "",
    },
    {
      tone: pendingCount === null ? h.stats[1]?.tone ?? "gold" : pendingCount > 0 ? "gold" : "green",
      value: pendingCount !== null ? String(pendingCount) : h.stats[1]?.value ?? "—",
      unit: "pendências",
      sub: pendingCount !== null ? (pendingCount > 0 ? "aprovações aguardando você" : "tudo em dia") : h.stats[1]?.sub ?? "",
    },
    {
      tone: "blue",
      value: compactDate || "—",
      unit: "próxima reunião",
      sub: `${nextEvent.title}${nextEvent.when.includes(" · ") ? " · " + nextEvent.when.split(" · ")[1] : ""}`,
    },
  ];
}

// Real activity feed — replaces the old "O que está acontecendo" cards, which
// used to just repeat the 3 stats above in a different shape.
function homeFeed(props: { ctx: PageCtx }): { icon: string; title: string; text: string }[] {
  const { content, payload } = props.ctx;
  const feed: { icon: string; title: string; text: string }[] = [];
  for (const t of (payload?.resolvedApprovals ?? []).slice(0, 2)) {
    feed.push({ icon: "check", title: t.status === "concluido" ? "Publicado" : "Aprovado", text: `${t.title} · ${fmtWhen(t.updated_at)}` });
  }
  const nextEvent = content.agenda.next;
  if (nextEvent.title) feed.push({ icon: "clock", title: "Próxima reunião", text: `${nextEvent.title} · ${nextEvent.when}` });
  const topMetric = payload?.results.topMetrics[0];
  if (topMetric) feed.push({ icon: "up", title: topMetric.label, text: `${topMetric.value}${topMetric.variation ? " · " + topMetric.variation : ""}` });
  return feed.length ? feed.slice(0, 3) : content.home.happening;
}

function HomePage(props: { ctx: PageCtx }) {
  const { content, name, briefingDone, manualDone, goTo } = props.ctx;
  const h = content.home;
  // The banner explicitly asks for both ("Leia o manual e responda o briefing").
  const onboardingDone = manualDone && briefingDone;
  const billing = content.central.billing;
  const stats = homeStats(props);
  const feed = homeFeed(props);
  return (
    <section className="np-home">
      <div className="np-banner">
        <div className="np-banner-main">
          <span className="np-banner-mark"><Ico name="diamond" /></span>
          <div>
            <span className="np-eyebrow">{h.banner.eyebrow}</span>
            <strong className="np-banner-title">{h.banner.title}</strong>
            <p>{h.banner.desc}</p>
          </div>
        </div>
        <div className="np-banner-actions">
          <span className={`np-pill ${onboardingDone ? "green" : "gold"}`}>{onboardingDone ? "Concluído" : h.banner.status}</span>
          <button className="np-btn primary" onClick={() => goTo("jornada")}>Abrir <Ico name="arrow" /></button>
        </div>
      </div>

      <div className="np-home-compass"><Compass activeDir="N" onGo={goTo} /></div>

      <div className="np-hero">
        <span className="np-eyebrow">Portal da {name}</span>
        <h1 className="np-serif np-hero-title">Sua jornada com a <i>North</i></h1>
        <p className="np-hero-lead">{h.heroLead}</p>
      </div>

      <div className="np-home-stats">
        {stats.map((s, i) => (
          <div className="np-stat" key={i}>
            <span className={`np-dot ${s.tone}`} />
            <div>
              <p><strong>{s.value}</strong> {s.unit}</p>
              <em>{s.sub}</em>
            </div>
          </div>
        ))}
      </div>

      <div className="np-home-pill-row">
        <span className={`np-pill ${billing.status === "Em dia" ? "green" : "gold"}`}>
          Pagamento · {billing.status} · {billing.next.label.toLowerCase()} {billing.next.date} · {billing.next.amount}
        </span>
      </div>

      <div className="np-happening">
        <h2 className="np-h2">O que está acontecendo</h2>
        <div className="np-hap-grid">
          {feed.map((c, i) => (
            <article className="np-hap-card" key={i}>
              <span className="np-hap-ico"><Ico name={c.icon} /></span>
              <h3>{c.title}</h3>
              <p>{c.text}</p>
            </article>
          ))}
        </div>
      </div>

      <div className="np-band"><p className="np-serif">{h.band}</p></div>
    </section>
  );
}

/* ============================= Pendências (Onboarding) ============================= */

function PendenciasPage(props: { ctx: PageCtx }) {
  const { content, goTo, briefingDone, manualDone, hasDocuments, documentsRead, accessDone } = props.ctx;
  const p = content.pendencias;

  const requiredItems = p.groups.find((g) => g.label === "Etapas obrigatórias")?.items ?? [];
  const requiredPending = requiredItems.filter((it) => !((it.page === "briefing" && briefingDone) || (it.title === "Manual do Cliente" && manualDone))).length;
  const docGroupItems = p.groups.find((g) => g.label === "Documentos pendentes")?.items ?? [];
  const docsPending = docGroupItems.filter((it) => !(it.page === "acessos" && accessDone)).length;
  const readingPending = hasDocuments && !documentsRead ? 1 : 0;
  const totalPending = requiredPending + docsPending + readingPending;

  return (
    <section className="np-page">
      <PageHead eyebrow="Jornada · Comece por aqui"
        title={<>Sua jornada começa <i>aqui</i></>}
        lead="Tudo o que precisa da sua atenção agora, em um só lugar: documentos pendentes, leitura dos documentos, briefing e trilhas obrigatórias (como o Manual do Cliente). Conclua as pendências para liberar a sua bússola." />
      <div className="np-alert gold">
        <span className="np-dot gold" />
        <p>
          <strong>{totalPending} pendência{totalPending === 1 ? "" : "s"} no total</strong>
          {" · "}{requiredPending} obrigatória{requiredPending === 1 ? "" : "s"}
          {" · "}{docsPending} documento{docsPending === 1 ? "" : "s"}
          {" · "}{readingPending} leitura{readingPending === 1 ? "" : "s"}
          {" — resolva para desbloquear a bússola"}
        </p>
      </div>
      {p.groups.map((g) => (
        <div className="np-pend-group" key={g.label}>
          <span className="np-section-label">{g.label}</span>
          {g.items.map((it) => {
            // Briefing, Manual do Cliente and Acessos are the items here with
            // a real completion signal available — reflect it instead of
            // always showing the static "Pendente" copy.
            const done = (it.page === "briefing" && briefingDone) || (it.title === "Manual do Cliente" && manualDone) || (it.page === "acessos" && accessDone);
            const locked = it.page ? isPageLocked(it.page as PageId) : false;
            return (
              <div className="np-pend-row" key={it.title}>
                <span className="np-pend-ico"><Ico name={it.icon} /></span>
                <div className="np-pend-text">
                  <strong>{it.title}</strong>
                  <em>{it.sub}</em>
                </div>
                <span className={`np-pill ${done ? "green" : "gold"}`}>{done ? "Concluído" : it.status}</span>
                {locked ? (
                  <span className="np-btn ghost sm locked" aria-disabled="true"><Ico name="lock" /> Em breve</span>
                ) : (
                  <button className="np-btn primary sm" onClick={() => it.page && goTo(it.page as PageId)}>
                    {done ? "Ver" : it.action} <Ico name="arrow" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ))}
      {hasDocuments ? (
        <div className="np-pend-group">
          <span className="np-section-label">Leitura de documentos</span>
          <div className="np-pend-row">
            <span className="np-pend-ico"><Ico name="target" /></span>
            <div className="np-pend-text">
              <strong>Ler documentos</strong>
              <em>Abra e confirme o recebimento de cada documento enviado</em>
            </div>
            <span className={`np-pill ${documentsRead ? "green" : "gold"}`}>{documentsRead ? "Concluído" : "Pendente"}</span>
            <button className="np-btn primary sm" onClick={() => goTo("documentos")}>
              {documentsRead ? "Ver" : "Ler"} <Ico name="arrow" />
            </button>
          </div>
        </div>
      ) : null}
      <div className="np-note"><Ico name="info" /><p>{p.note}</p></div>
    </section>
  );
}

/* ============================= Central Comercial ============================= */

// Real checkpoints (kind='checkpoint_comercial') replace the static demo list
// whenever the client has any provisioned — falls back to static content only
// for clients created before this feature shipped.
function checkpointsView(rows: ClientTask[]): { title: string; date: string; status: string; tone: Tone }[] {
  return rows.map((t) => {
    const pct = taskProgress(t);
    const status = pct >= 100 ? "Concluído" : pct === 0 ? "A iniciar" : "Em andamento";
    const tone: Tone = pct >= 100 ? "green" : pct === 0 ? "neutral" : "gold";
    const date = t.due_date ? fmtDocDate(t.due_date) : t.updated_at ? fmtDocDate(t.updated_at) : "—";
    return { title: t.title, date, status, tone };
  });
}

function CentralPage(props: { ctx: PageCtx }) {
  const c = props.ctx.content.central;
  const realCheckpoints = props.ctx.payload?.checkpoints ?? [];
  const checkpoints = realCheckpoints.length ? checkpointsView(realCheckpoints) : c.checkpoints;
  return (
    <section className="np-page">
      <PageHead eyebrow="North · Central Comercial" title={<>Seu <i>contrato</i></>}
        lead="Plano, escopo, cobrança e checkpoints — tudo em um só lugar." />
      <div className="np-plan">
        <div className="np-plan-main">
          <div className="np-plan-title">
            <strong className="np-serif">{c.plan.name}</strong>
            <span className="np-pill green">{c.plan.status}</span>
            <span className="np-pill green">{c.plan.payment}</span>
          </div>
          <p className="np-plan-term">{c.plan.term}</p>
        </div>
        <div className="np-plan-price">
          <p className="np-serif"><strong>{c.plan.price}</strong><span>{c.plan.per}</span></p>
          <div className="np-plan-btns">
            <button className="np-btn ghost sm">Ver contrato (PDF)</button>
            <button className="np-btn primary sm">Ver faturas</button>
          </div>
        </div>
      </div>

      <div className="np-central-grid">
        <div className="np-col">
          <div className="np-card">
            <h3>Escopo contratado</h3>
            <ul className="np-scope">
              {c.scope.map((s) => (
                <li key={s.title}><span className="np-check"><Ico name="check" /></span><div><strong>{s.title}</strong><em>{s.desc}</em></div></li>
              ))}
            </ul>
          </div>
          <div className="np-card">
            <h3>Checkpoints comerciais</h3>
            <ul className="np-checkpoints">
              {checkpoints.map((cp) => (
                <li key={cp.title}>
                  <span className={`np-dot ${cp.tone}`} />
                  <div><strong>{cp.title}</strong><em>{cp.date}</em></div>
                  <span className={`np-pill ${cp.tone}`}>{cp.status}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="np-col">
          <div className="np-card">
            <div className="np-card-head"><h3>Cobrança</h3><span className="np-pill green">{c.billing.status}</span></div>
            <div className="np-next-invoice">
              <div><em>{c.billing.next.label}</em><strong>{c.billing.next.date}</strong></div>
              <span className="np-serif np-amount">{c.billing.next.amount}</span>
            </div>
            <dl className="np-defs">
              <div><dt>Método</dt><dd>{c.billing.method}</dd></div>
              <div><dt>Ciclo</dt><dd>{c.billing.cycle}</dd></div>
              <div><dt>Responsável</dt><dd>{c.billing.responsible}</dd></div>
            </dl>
          </div>
          <div className="np-card">
            <h3>Histórico de faturas</h3>
            <ul className="np-invoices">
              {c.invoices.map((iv) => (
                <li key={iv.month}>
                  <div><strong>{iv.month}</strong><em>{iv.detail}</em></div>
                  <span className={`np-pill ${iv.tone}`}>{iv.status}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================= Acessos & Pastas ============================= */

function AcessosPage(props: { ctx: PageCtx }) {
  const { content, links, credentials, accessDone, onCredentialSave } = props.ctx;
  const a = content.acessos;
  const [openPlatform, setOpenPlatform] = useState<CredentialSummary | null>(null);
  const pendingCount = credentials.filter((c) => !(c.username.trim() && c.hasPassword)).length;

  return (
    <section className="np-page">
      <PageHead eyebrow="Cliente · Acessos & pastas" title={<>Pastas <span className="np-amp">&amp;</span> <i>acessos</i></>}
        lead="Suas pastas no Drive e o status dos acessos que a North precisa para trabalhar." />
      {accessDone ? (
        <div className="np-alert green"><span className="np-dot green" /><p><strong>Acessos completos</strong> — pastas e credenciais registradas, o time North já pode trabalhar.</p></div>
      ) : null}
      <div className="np-folders">
        {a.folders.map((f) => {
          const url = links ? (links[f.key as keyof typeof links] as string | null) : null;
          return (
            <div className="np-folder" key={f.title}>
              <div className="np-folder-head">
                <span className="np-folder-ico"><Ico name="folder" /></span>
                <div><strong>{f.title}</strong><em>{f.count}</em></div>
              </div>
              <ul className="np-dot-list">{f.items.map((i) => <li key={i}>{i}</li>)}</ul>
              <div className="np-folder-foot">
                <span className={`np-pill ${url ? "green" : "gold"}`}>{url ? "Organizado" : "Pendente"}</span>
                {url ? <a className="np-link" href={url} target="_blank" rel="noopener noreferrer">Abrir no Drive <Ico name="arrow" /></a>
                     : <span className="np-link muted">Abrir no Drive <Ico name="arrow" /></span>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="np-card">
        <div className="np-card-head"><h3>Acessos necessários</h3><span className={`np-pill ${pendingCount === 0 ? "green" : "gold"}`}>{pendingCount === 0 ? "Concedidos" : `${pendingCount} pendente${pendingCount === 1 ? "" : "s"}`}</span></div>
        <ul className="np-grants">
          {credentials.map((c) => {
            const meta = ACCESS_PLATFORMS.find((p) => p.key === c.platform);
            const granted = Boolean(c.username.trim() && c.hasPassword);
            return (
              <li key={c.platform}>
                <span className="np-grant-ini">{meta?.label.slice(0, 1) ?? "?"}</span>
                <div className="np-grant-text"><strong>{meta?.label ?? c.platform}</strong><em>{meta?.desc}</em></div>
                <span className={`np-pill ${granted ? "green" : "gold"}`}>{granted ? "Concedido" : "Pendente"}</span>
                <button className={`np-btn ${granted ? "ghost" : "primary"} sm`} onClick={() => setOpenPlatform(c)}>{granted ? "Gerenciar" : "Conceder"}</button>
              </li>
            );
          })}
        </ul>
      </div>

      {openPlatform ? (
        <CredentialModal credential={openPlatform} onSave={onCredentialSave} onClose={() => setOpenPlatform(null)} />
      ) : null}
    </section>
  );
}

function CredentialModal(props: {
  credential: CredentialSummary;
  onSave: (input: { platform: string; username: string; password?: string; notes?: string }) => Promise<void>;
  onClose: () => void;
}) {
  const { credential, onSave, onClose } = props;
  const meta = ACCESS_PLATFORMS.find((p) => p.key === credential.platform);
  const [username, setUsername] = useState(credential.username);
  const [password, setPassword] = useState("");
  const [notes, setNotes] = useState(credential.notes);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    if (!username.trim()) { setError("Informe o login/e-mail."); return; }
    if (!credential.hasPassword && !password.trim()) { setError("Informe a senha."); return; }
    setSaving(true);
    setError("");
    try {
      await onSave({ platform: credential.platform, username: username.trim(), password: password.trim() || undefined, notes: notes.trim() });
      onClose();
    } catch {
      setError("Não foi possível salvar. Tente novamente.");
    }
    setSaving(false);
  }

  return (
    <div className="np-modal-backdrop" onClick={onClose}>
      <div className="np-modal" onClick={(e) => e.stopPropagation()}>
        <div className="np-modal-head">
          <div><h3>{meta?.label ?? credential.platform}</h3><em className="np-doc-modal-empty">{meta?.desc}</em></div>
          <button className="np-modal-close" onClick={onClose} aria-label="Fechar">✕</button>
        </div>
        <label className="np-field">
          <span>Login / e-mail</span>
          <input className="np-input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="voce@empresa.com" />
        </label>
        <label className="np-field">
          <span>Senha{credential.hasPassword ? " (deixe em branco para manter a atual)" : ""}</span>
          <input className="np-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={credential.hasPassword ? "••••••••" : "Senha"} />
        </label>
        <label className="np-field">
          <span>Observações (opcional)</span>
          <textarea className="np-modal-textarea" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: autenticação em duas etapas ativa" />
        </label>
        {error ? <p className="np-field-error">{error}</p> : null}
        <div className="np-modal-actions">
          <button className="np-btn ghost sm" onClick={onClose}>Cancelar</button>
          <button className="np-btn primary sm" onClick={handleSave} disabled={saving}>{saving ? "Salvando…" : "Salvar acesso"}</button>
        </div>
      </div>
    </div>
  );
}

/* ============================= Entregas (Feedbacks) ============================= */

function fmtWhen(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "agora";
  const h = Math.floor(diff / 3.6e6);
  if (h < 1) return "há minutos";
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "há 1 dia" : `há ${d} dias`;
}

function EntregasPage(props: {
  ctx: PageCtx;
  pending: ClientTask[];
  resolved: ClientTask[];
  sessionUserId: string | null;
  sessionLevel?: string | null;
  onActed: () => void;
}) {
  const { ctx, pending, resolved, sessionUserId, sessionLevel, onActed } = props;
  const isManager = sessionLevel === "gerente";
  const [busyId, setBusyId] = useState("");
  const [adjustFor, setAdjustFor] = useState<ClientTask | null>(null);
  const [toast, setToast] = useState("");

  function flash(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(""), 3200);
  }

  async function act(task: ClientTask, action: "aprovar" | "ajustes", comment?: string) {
    setBusyId(task.id);
    try {
      const res = await fetch(`/api/client/${ctx.slug}/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(comment ? { action, comment } : { action }),
      });
      if (!res.ok) throw new Error();
      flash(action === "aprovar" ? "Entrega aprovada." : "Ajuste enviado ao time North.");
      onActed();
    } catch {
      flash("Não foi possível enviar. Tente novamente.");
    }
    setBusyId("");
  }

  // O card só é acionável por quem está marcado como aprovador — ou por um
  // 'gerente' da conta, que pode aprovar cards atribuídos a 'usuario'
  // (contas normais) da mesma empresa. Outras pessoas veem o card sem poder
  // agir (a RLS garante isso mesmo que a UI falhe).
  const canActOn = (t: ClientTask) => Boolean(sessionUserId) && (t.approver_id === sessionUserId || isManager);
  const sorted = [...pending].sort((a, b) => (canActOn(a) ? 0 : 1) - (canActOn(b) ? 0 : 1));

  return (
    <section className="np-page">
      <PageHead eyebrow="Operação · Feedbacks" title={<>Feedbacks</>}
        lead="Aprove entregas do time North — o que precisa de você agora aparece primeiro." />

      {sorted.length === 0 ? (
        <div className="np-card"><p className="np-muted-sm" style={{ margin: 0 }}>Nenhuma entrega aguardando aprovação no momento.</p></div>
      ) : (
        <div className="np-approvals">
          {sorted.map((t) => {
            const yourTurn = canActOn(t);
            const canAct = yourTurn && !busyId;
            const comments = commentsOf(t.payload);
            const materialLink = extractLatestLink(comments) ?? ctx.links?.uploadsUrl ?? null;
            return (
              <div className={`np-approval ${yourTurn ? "np-approval-turn" : ""}`} key={t.id}>
                <div className={`np-approval-cover tone-${kindTone(t.kind)}`}>
                  <span className="np-pill light">{kindLabel(t.kind)}</span>
                  {yourTurn ? <span className="np-pill gold np-approval-flag">Sua vez</span> : null}
                </div>
                <div className="np-approval-body">
                  <div className="np-approval-head">
                    <div>
                      <strong>{t.title}</strong>
                      <em>{t.assignee ? `Enviado por ${t.assignee}` : "North"}{t.due_date ? ` · prazo ${t.due_date}` : ""}</em>
                    </div>
                    <span className="np-pill gold">Aguardando aprovação</span>
                  </div>
                  {t.description ? <div className="np-approval-note"><p>{t.description}</p></div> : null}
                  {materialLink ? (
                    <a className="np-link" href={materialLink} target="_blank" rel="noopener noreferrer">
                      {t.kind === "criativo" ? "Abrir criativo" : "Ver material"} <Ico name="arrow" />
                    </a>
                  ) : null}
                  {comments.length > 0 ? (
                    <div className="np-approval-comments">
                      {comments.slice(-3).map((c, i) => (
                        <p className="np-approval-comment" key={i}>
                          <b>{c.author}</b> <small>{formatCommentTime(c.at)}</small>: <CommentText text={c.text} />
                        </p>
                      ))}
                    </div>
                  ) : null}
                  {!t.approver_id && !isManager ? (
                    <p className="np-muted-sm">Aguardando o time North atribuir um aprovador a este card.</p>
                  ) : !yourTurn ? (
                    <p className="np-muted-sm">Outra pessoa da sua conta é responsável por aprovar este card.</p>
                  ) : isManager && t.approver_id !== sessionUserId ? (
                    <p className="np-muted-sm">Aprovando como gerente da conta.</p>
                  ) : null}
                  <div className="np-approval-btns">
                    <button className="np-btn ghost" disabled={!canAct} onClick={() => setAdjustFor(t)}>Solicitar ajustes</button>
                    <button className="np-btn primary" disabled={!canAct} onClick={() => void act(t, "aprovar")}>
                      {busyId === t.id ? "Enviando…" : "Aprovar entrega"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="np-card">
        <span className="np-section-label">Histórico</span>
        <ul className="np-recent">
          {resolved.map((t) => (
            <li key={t.id}>
              <span className={`np-recent-thumb tone-${kindTone(t.kind)}`} />
              <div className="np-recent-text">
                <strong>{t.title}</strong>
                <em>{kindLabel(t.kind)}{t.assignee ? ` · ${t.assignee}` : ""}</em>
              </div>
              <span className="np-muted-sm">{fmtWhen(t.updated_at)}</span>
              <span className={`np-pill ${t.status === "concluido" ? "green" : "blue"}`}>
                {t.status === "concluido" ? "Publicado" : "Concluído"}
              </span>
            </li>
          ))}
          {resolved.length === 0 ? <li className="np-doc-empty">Nenhuma entrega concluída ainda.</li> : null}
        </ul>
      </div>

      {adjustFor ? (
        <AdjustModal
          task={adjustFor}
          busy={busyId === adjustFor.id}
          onClose={() => setAdjustFor(null)}
          onSubmit={(text) => {
            const t = adjustFor;
            setAdjustFor(null);
            void act(t, "ajustes", text);
          }}
        />
      ) : null}

      {toast ? <div className="np-toast" role="status">{toast}</div> : null}
    </section>
  );
}

function AdjustModal(props: { task: ClientTask; busy: boolean; onClose: () => void; onSubmit: (text: string) => void }) {
  const { task, busy, onClose, onSubmit } = props;
  const [text, setText] = useState("");
  return (
    <div className="np-modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="np-modal" onClick={(e) => e.stopPropagation()}>
        <div className="np-modal-head">
          <div>
            <span className="np-eyebrow">Solicitar ajustes</span>
            <h3 className="np-serif">{task.title}</h3>
          </div>
          <button className="np-modal-close" onClick={onClose} aria-label="Fechar" disabled={busy}>✕</button>
        </div>
        <p className="np-muted-sm">Descreva o que precisa mudar — o time North recebe o card de volta com o seu comentário.</p>
        <textarea
          className="np-modal-textarea"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ex.: trocar a cor de fundo da capa 2 para o âmbar da marca…"
          autoFocus
        />
        <div className="np-modal-actions">
          <button className="np-btn ghost" onClick={onClose} disabled={busy}>Cancelar</button>
          <button className="np-btn primary" onClick={() => text.trim() && onSubmit(text.trim())} disabled={busy || !text.trim()}>
            {busy ? "Enviando…" : "Enviar ajuste"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================= Documentos ============================= */

const DOC_CATEGORY: Record<DocumentRecord["doc_type"], string> = {
  contrato: "Contratos", proposta: "Contratos", relatorio: "Relatórios", material: "Materiais",
};
const DOC_TONE: Record<DocumentRecord["doc_type"], Tone> = {
  contrato: "green", proposta: "green", relatorio: "gold", material: "purple",
};
const DOC_STATUS_LABEL: Record<DocumentRecord["status"], string> = {
  enviada: "Enviada", assinado: "Assinado", aguardando_assinatura: "Aguardando assinatura",
  publicado: "Publicado", compartilhado: "Compartilhado",
};
function fmtDocDate(iso: string | null): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${m[3]} ${MES[Number(m[2]) - 1]} ${m[1]}`;
}

function DocumentosPage(props: { ctx: PageCtx; documents?: DocumentRecord[] }) {
  const real = props.documents ?? [];
  const [filter, setFilter] = useState("Todos");
  const [openDoc, setOpenDoc] = useState<DocumentRecord | null>(null);

  if (real.length === 0) {
    return (
      <section className="np-page">
        <PageHead eyebrow="North · Documentos" title={<>Seus <i>documentos</i></>}
          lead="Contratos, propostas e relatórios — sempre à mão." />
        <div className="np-card np-empty-state">
          <p>Nenhum documento disponível ainda. Assim que a North enviar um contrato, proposta ou relatório, ele aparece aqui.</p>
        </div>
      </section>
    );
  }

  const filters = ["Todos", "Contratos", "Relatórios", "Materiais"];
  const items = filter === "Todos" ? real : real.filter((doc) => DOC_CATEGORY[doc.doc_type] === filter);
  return (
    <section className="np-page">
      <PageHead eyebrow="North · Documentos" title={<>Seus <i>documentos</i></>}
        lead="Contratos, propostas e relatórios — sempre à mão." />
      <div className="np-chips">
        {filters.map((f) => (
          <button key={f} className={`np-chip ${filter === f ? "on" : ""}`} onClick={() => setFilter(f)}>{f}</button>
        ))}
      </div>
      <div className="np-card">
        <ul className="np-docs">
          {items.map((doc) => (
            <li key={doc.id}>
              <span className={`np-doc-badge tone-${DOC_TONE[doc.doc_type]}`}>{fileTypeLabel(doc)}</span>
              <div className="np-doc-text"><strong>{doc.name}</strong><em>{DOC_CATEGORY[doc.doc_type]} · {fmtDocDate(doc.doc_date)}{doc.size_bytes !== null ? ` · ${formatFileSize(doc.size_bytes)}` : ""}</em></div>
              <span className={`np-pill ${doc.read_at ? "green" : DOC_TONE[doc.doc_type]}`}>{doc.read_at ? "Lido" : DOC_STATUS_LABEL[doc.status]}</span>
              <button className="np-btn ghost sm" onClick={() => setOpenDoc(doc)}>{doc.read_at ? "Reabrir" : "Ler"}</button>
            </li>
          ))}
          {items.length === 0 ? <li className="np-doc-empty">Nenhum documento nesta categoria.</li> : null}
        </ul>
      </div>

      {openDoc ? <DocumentViewerModal doc={openDoc} onRead={props.ctx.onDocumentRead} onClose={() => setOpenDoc(null)} /> : null}
    </section>
  );
}

function DocumentViewerModal(props: { doc: DocumentRecord; onRead: (id: string) => void; onClose: () => void }) {
  const { doc, onRead, onClose } = props;
  useEffect(() => {
    if (!doc.read_at) onRead(doc.id);
    // Marks read once, on open — not meant to re-fire if the parent re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id]);

  return (
    <div className="np-modal-backdrop" onClick={onClose}>
      <div className="np-modal np-doc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="np-modal-head">
          <span className={`np-doc-badge tone-${DOC_TONE[doc.doc_type]}`}>{fileTypeLabel(doc)}</span>
          <div className="np-doc-text"><strong>{doc.name}</strong><em>{doc.original_file_name || DOC_CATEGORY[doc.doc_type]} · {doc.mime_type || fileTypeLabel(doc)}{doc.size_bytes !== null ? ` · ${formatFileSize(doc.size_bytes)}` : ""}</em></div>
          <button className="np-modal-close" onClick={onClose} aria-label="Fechar">✕</button>
        </div>
        <p className="np-doc-modal-status"><span className="np-pill green">Lido</span> Confirmamos o recebimento deste documento.</p>
        <DocumentFilePreview file={doc} compact />
        {doc.file_url ? (
          <a className="np-btn primary" href={doc.file_url} target="_blank" rel="noopener noreferrer">Abrir arquivo ↗</a>
        ) : (
          <p className="np-doc-modal-empty">Sem arquivo anexado — este registro é apenas informativo.</p>
        )}
      </div>
    </div>
  );
}

/* ============================= Time North ============================= */

function TimePage(props: { ctx: PageCtx }) {
  const t = props.ctx.content.time;
  return (
    <section className="np-page">
      <PageHead eyebrow="North · Time" title={<>Seu time na <i>North</i></>}
        lead="As pessoas que cuidam da sua conta no dia a dia." />
      <div className="np-lead-contact">
        <span className="np-grant-ini lg">{t.lead.initials}</span>
        <div className="np-lead-text">
          <span className="np-eyebrow">{t.lead.role}</span>
          <strong className="np-serif">{t.lead.name}</strong>
          <p>{t.lead.note}</p>
        </div>
        <button className="np-btn primary">Chamar no WhatsApp</button>
      </div>
      <div className="np-team">
        {t.members.map((m) => (
          <div className="np-team-card" key={m.name}>
            <span className={`np-grant-ini lg tone-${m.tone}`}>{m.initials}</span>
            <strong>{m.name}</strong>
            <span className={`np-pill ${m.tone}`}>{m.role}</span>
            <p>{m.desc}</p>
            <div className="np-team-btns"><button className="np-btn ghost sm">WhatsApp</button><button className="np-btn ghost sm">E-mail</button></div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ============================= Trilhas North ============================= */

const TRAIL_TYPE_ICON: Record<string, string> = { Slides: "book", Vídeo: "play", Guia: "book" };
const TRAIL_STATUS_TONE: Record<string, Tone> = {
  Pendente: "gold", "Em andamento": "blue", Concluído: "green", "Em breve": "neutral",
};

function TrilhasPage(props: { ctx: PageCtx }) {
  const t = props.ctx.content.trilhas;
  const hero = t.items.filter((it) => it.hero);
  const rest = t.items.filter((it) => !it.hero);
  const [manualOpen, setManualOpen] = useState(false);
  const manualSeen = props.ctx.manualDone;

  const statusFor = (it: (typeof t.items)[number]) =>
    it.title === "Manual do Cliente" && manualSeen ? "Concluído" : it.status;

  return (
    <section className="np-page">
      <PageHead eyebrow="North · Trilhas North" title={<>Trilhas <i>North</i></>}
        lead="Sua central educacional: slides e vídeos para tirar o máximo da parceria com a North, na ordem certa." />

      {hero.length > 0 && (
        <div className="np-trail-hero-group">
          {hero.map((it) => (
            <div className="np-trail-hero" key={it.title}>
              <span className="np-trail-hero-ico"><Ico name={TRAIL_TYPE_ICON[it.type] ?? "book"} /></span>
              <div className="np-trail-hero-text">
                <span className="np-eyebrow">Material principal · {it.etapa}</span>
                <strong className="np-serif">{it.title}</strong>
                <p>{it.desc}</p>
                <div className="np-trail-hero-meta">
                  <span className="np-pill light">{it.type}</span>
                  <span className={`np-pill ${TRAIL_STATUS_TONE[statusFor(it)]}`}>{statusFor(it)}</span>
                </div>
              </div>
              <button
                className="np-btn primary"
                disabled={it.status === "Em breve"}
                onClick={() => it.title === "Manual do Cliente" && setManualOpen(true)}
              >
                {manualSeen && it.title === "Manual do Cliente" ? "Reabrir" : it.cta} <Ico name="arrow" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="np-card np-trail-list">
        <span className="np-section-label">Todos os materiais</span>
        {rest.length === 0 && hero.length === 0 ? (
          <p className="np-doc-empty">Nenhum material publicado ainda.</p>
        ) : rest.map((it) => (
          <div className="np-trail-row" key={it.title}>
            <span className="np-trail-ord">{String(it.ordem).padStart(2, "0")}</span>
            <span className="np-doc-badge"><Ico name={TRAIL_TYPE_ICON[it.type] ?? "book"} /></span>
            <div className="np-doc-text">
              <strong>{it.title}</strong>
              <em>{it.type} · Etapa: {it.etapa}{it.doneAt ? ` · concluído em ${it.doneAt}` : ""}</em>
            </div>
            <span className={`np-pill ${TRAIL_STATUS_TONE[it.status]}`}>{it.status}</span>
            <button className="np-btn ghost sm" disabled={it.status === "Em breve"}>{it.cta}</button>
          </div>
        ))}
      </div>

      {manualOpen ? (
        <ManualDoCliente
          onClose={() => setManualOpen(false)}
          onOpenBriefing={() => props.ctx.goTo("briefing")}
          onFinish={props.ctx.onManualFinish}
          clientName={props.ctx.name}
        />
      ) : null}
    </section>
  );
}

/* ============================= Agenda ============================= */

function AgendaPage(props: { ctx: PageCtx }) {
  const a = props.ctx.content.agenda;
  const cal = a.calendar;
  const cells: (number | null)[] = [
    ...Array.from({ length: cal.startDow }, () => null),
    ...Array.from({ length: cal.days }, (_, i) => i + 1),
  ];
  return (
    <section className="np-page">
      <PageHead eyebrow="Operação · Agenda" title={<>Sua <i>agenda</i></>}
        lead="Reuniões, entregas e marcos do mês com a North." />
      <div className="np-agenda-grid">
        <div className="np-card">
          <span className="np-section-label">Próximos eventos</span>
          <ul className="np-events">
            {a.events.map((ev) => (
              <li key={ev.day + ev.title}>
                <span className="np-event-date"><strong>{ev.day}</strong><em>{ev.month}</em></span>
                <div className="np-event-text"><strong>{ev.title}</strong><em>{ev.meta}</em></div>
                <span className={`np-pill ${ev.tone}`}>{ev.tag}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="np-col">
          <div className="np-card np-next-event">
            <span className="np-eyebrow">Próximo evento</span>
            <strong className="np-serif">{a.next.title}</strong>
            <em className="np-next-when">{a.next.when}</em>
            <p>{a.next.desc}</p>
            <button className="np-btn primary">Entrar no Google Meet</button>
          </div>
          <div className="np-card">
            <h3>Precisa falar com a North?</h3>
            <p className="np-muted-p">Solicite uma reunião extra e a equipe retorna com horários.</p>
            <button className="np-btn ghost">Solicitar reunião</button>
          </div>
        </div>
      </div>

      <div className="np-card">
        <div className="np-cal-head">
          <div><span className="np-eyebrow">Calendário</span><h3 className="np-serif">{cal.title}</h3></div>
          <div className="np-cal-legend">
            {a.legend.map((l) => <span key={l.label}><i className={`np-dot ${l.tone}`} />{l.label}</span>)}
          </div>
        </div>
        <div className="np-cal">
          {["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"].map((d) => <span className="np-cal-dow" key={d}>{d}</span>)}
          {cells.map((n, i) => (
            <div className={`np-cal-cell ${n === null ? "empty" : ""}`} key={i}>
              {n !== null && <span className="np-cal-num">{n}</span>}
              {n !== null && cal.marks[String(n)] && (
                <span className={`np-cal-mark ${cal.marks[String(n)].tone}`}>{cal.marks[String(n)].tag}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================= Plano de Ação ============================= */

function PlanoPage(props: { ctx: PageCtx }) {
  const items = props.ctx.content.plano;
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  return (
    <section className="np-page">
      <PageHead eyebrow="Operação · Plano de Ação" title={<>Plano de <i>ação</i></>}
        lead="O que a North vai atacar nos próximos 30 dias — alimentado pelo Kanban." />
      <div className="np-plano-list">
        {items.map((it, idx) => {
          const acts = it.activities ?? [];
          const open = openIdx === idx;
          return (
            <div className="np-card np-plano-card" key={it.title}>
              <div className="np-plano-head">
                <strong>{it.title}</strong>
                <span className={`np-pill ${it.statusTone}`}>{it.status}</span>
              </div>
              <p className="np-muted-p">{it.desc}</p>
              <div className="np-progress">
                <div className="np-progress-track"><div className={`np-progress-fill ${it.barTone}`} style={{ width: `${it.pct}%` }} /></div>
                <span>{it.pct}%</span>
              </div>
              <div className="np-plano-foot">
                <span className="np-grant-ini sm">{it.responsible}</span><em>Responsável · North</em>
                {it.dateRange ? <span className="np-kanban"><Ico name="clock" /> {it.dateRange}</span> : <span className="np-kanban"><Ico name="arrow" /> {it.kanban}</span>}
              </div>
              {acts.length > 0 ? (
                <>
                  <button className="np-plano-toggle" onClick={() => setOpenIdx(open ? null : idx)}>
                    <span className={`np-plano-caret ${open ? "on" : ""}`}>▸</span>
                    {acts.length} atividade{acts.length === 1 ? "" : "s"} neste plano
                  </button>
                  {open ? (
                    <ul className="np-plano-acts">
                      {acts.map((a, i) => (
                        <li key={i}>
                          <span className="np-plano-act-title">{a.title}</span>
                          <span className="np-plano-act-stage">{a.status}</span>
                          <span className="np-plano-act-pct">{a.pct}%</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ============================= Dashboard ============================= */

function DashboardPage(props: { ctx: PageCtx; results?: PortalPayload["results"] }) {
  const r = props.results;
  const d = props.ctx.content.dashboard;
  // Métricas reais (client_results, editadas no admin) têm prioridade sobre o conteúdo estático.
  const metrics = r && r.topMetrics.length > 0
    ? r.topMetrics.map((m) => ({
        label: m.label, value: m.value, delta: m.variation ?? "",
        tone: (m.variation?.startsWith("+") ? "green" : m.variation?.startsWith("-") ? "gold" : "neutral") as Tone,
      }))
    : d.metrics;
  const [range, setRange] = useState(d.ranges[1] ?? d.ranges[0]);
  const max = Math.max(...d.weekly.map((w) => w.value));
  // donut
  let acc = 0;
  const R = 54, C = 2 * Math.PI * R;
  const toneColor: Record<Tone, string> = {
    green: "var(--np-green)", gold: "var(--np-gold)", blue: "var(--np-blue)", purple: "var(--np-purple)", neutral: "var(--np-muted)",
  };
  return (
    <section className="np-page">
      <div className="np-page-head-row">
        <PageHead eyebrow="Resultados · Dashboard" title={<>Seus <i>resultados</i></>}
          lead="Tudo que a North entregou, consolidado em números." />
        <div className="np-range">
          {d.ranges.map((rg) => <button key={rg} className={range === rg ? "on" : ""} onClick={() => setRange(rg)}>{rg}</button>)}
        </div>
      </div>

      {r?.reportUrl || r?.feedbackUrl ? (
        <div className="np-dash-links">
          {r.reportUrl ? <a href={r.reportUrl} target="_blank" rel="noopener noreferrer" className="np-btn ghost">Ver relatório ↗</a> : null}
          {r.feedbackUrl ? <a href={r.feedbackUrl} target="_blank" rel="noopener noreferrer" className="np-btn ghost">Ver feedback ↗</a> : null}
        </div>
      ) : null}

      <div className="np-metrics">
        {metrics.map((m) => (
          <div className="np-metric" key={m.label}>
            <span className="np-metric-label">{m.label}</span>
            <div className="np-metric-row"><strong className="np-serif">{m.value}</strong><span className={`np-pill ${m.tone}`}>{m.delta}</span></div>
          </div>
        ))}
      </div>

      <div className="np-dash-grid">
        <div className="np-card">
          <div className="np-card-head"><h3>Alcance por semana</h3><span className="np-pill green">{d.weeklyTag}</span></div>
          <div className="np-bars">
            {d.weekly.map((w) => (
              <div className="np-bar-col" key={w.label}>
                <div className="np-bar" style={{ height: `${(w.value / max) * 100}%` }} />
                <em>{w.label}</em>
              </div>
            ))}
          </div>
        </div>
        <div className="np-card">
          <h3>Origem do alcance</h3>
          <div className="np-donut-wrap">
            <svg className="np-donut" viewBox="0 0 140 140">
              <circle cx="70" cy="70" r={R} className="np-donut-bg" />
              {d.sources.map((s) => {
                const len = (s.pct / 100) * C;
                const el = (
                  <circle key={s.label} cx="70" cy="70" r={R} fill="none" stroke={toneColor[s.tone]} strokeWidth="16"
                    strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc} transform="rotate(-90 70 70)" />
                );
                acc += len;
                return el;
              })}
              <text x="70" y="76" textAnchor="middle" className="np-donut-total np-serif">{d.sourcesTotal}</text>
            </svg>
            <ul className="np-donut-legend">
              {d.sources.map((s) => (
                <li key={s.label}><span className={`np-dot ${s.tone}`} />{s.label}<b>{s.pct}%</b></li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="np-card">
        <div className="np-card-head"><h3>Conteúdo de melhor performance</h3><a className="np-link" href="#dashboard">Ver tudo</a></div>
        <table className="np-table">
          <thead><tr><th>Conteúdo</th><th>Tipo</th><th>Alcance</th><th>Engaj.</th><th>Resultado</th></tr></thead>
          <tbody>
            {d.topContent.map((r) => (
              <tr key={r.title}>
                <td><div className="np-tc"><span className={`np-recent-thumb tone-${r.typeTone}`} /><div><strong>{r.title}</strong><em>{r.meta}</em></div></div></td>
                <td><span className={`np-pill ${r.typeTone}`}>{r.type}</span></td>
                <td className="np-td-num">{r.reach}</td>
                <td className="np-td-num">{r.engage}</td>
                <td><span className="np-pill green">{r.result}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {r && r.insights.length > 0 ? (
        <div className="np-card">
          <div className="np-card-head"><h3>Insights recentes</h3></div>
          <ul className="np-insights">
            {r.insights.map((ins) => (
              <li key={ins.title}>
                <strong>{ins.title}</strong>
                {ins.category ? <span className="np-pill neutral">{ins.category}</span> : null}
                <p>{ins.description}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/* ============================= Configurações ============================= */

function ConfigPage(props: {
  ctx: PageCtx;
  theme: PortalPrefs["theme"];
  onTheme: (t: PortalPrefs["theme"]) => void;
  prefs: PortalPrefs | null;
  avatarStyle: number;
  onSave: (patch: Partial<PortalPrefs>) => void;
}) {
  const { name, slug } = props.ctx;
  const [nameVal, setNameVal] = useState(props.prefs?.displayName || name);
  const [userVal, setUserVal] = useState(props.prefs?.username || `@${slug}`);
  return (
    <section className="np-page">
      <PageHead eyebrow="Conta" title={<>Suas <i>configurações</i></>} lead="Seus dados de acesso e preferências do portal." />
      <div className="np-config-grid">
        <div className="np-card">
          <h3>Perfil</h3>
          <div className="np-avatar-row">
            <span className="np-avatar lg" style={{ background: AVATAR_STYLES[props.avatarStyle] }}>{initials(nameVal)}</span>
            <div>
              <span className="np-section-label">Foto de perfil · 5 estilos padrão</span>
              <div className="np-swatches">
                {AVATAR_STYLES.map((color, i) => (
                  <button key={color} className={`np-swatch ${props.avatarStyle === i ? "on" : ""}`}
                    style={{ background: color }} onClick={() => props.onSave({ avatarStyle: i })} aria-label={`Estilo ${i + 1}`}>
                    {props.avatarStyle === i && <Ico name="check" />}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <label className="np-field"><span>Nome</span>
            <input value={nameVal} onChange={(e) => setNameVal(e.target.value)} onBlur={() => props.onSave({ displayName: nameVal })} />
          </label>
          <label className="np-field"><span>Usuário</span>
            <input value={userVal} onChange={(e) => setUserVal(e.target.value)} onBlur={() => props.onSave({ username: userVal })} />
          </label>
          <label className="np-field"><span>E-mail de acesso <em className="np-tagline">definido pela North</em></span>
            <input value={`${slug}@north.test`} disabled />
          </label>
          <button className="np-btn primary" onClick={() => props.onSave({ displayName: nameVal, username: userVal })}>Salvar alterações</button>
        </div>
        <div className="np-col">
          <div className="np-card">
            <h3>Aparência</h3>
            <p className="np-muted-p">Tema do portal — claro ou escuro.</p>
            <div className="np-theme-switch">
              <button className={props.theme === "light" ? "on" : ""} onClick={() => props.onTheme("light")}><span className="np-radio" />Claro</button>
              <button className={props.theme === "dark" ? "on" : ""} onClick={() => props.onTheme("dark")}><span className="np-radio dark" />Escuro</button>
            </div>
            <p className="np-muted-sm">Aplicado em todo o portal e salvo na sua conta.</p>
          </div>
          <div className="np-card">
            <h3>Sessão</h3>
            <a className="np-btn danger" href="/logout">Sair da conta</a>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================= Briefing (wizard) ============================= */

function BriefingPage(props: {
  step: number;
  setStep: (n: number) => void;
  answers: Record<string, unknown>;
  onAnswer: (k: string, v: string) => void;
  onFinish: () => void;
  chip: SaveChip;
  onGo: (p: PageId) => void;
}) {
  const total = briefSteps.length;
  if (props.step === 0) return <CafePage onStart={() => props.setStep(1)} onGo={props.onGo} />;

  const idx = props.step - 1;
  const step = briefSteps[idx];
  const totalCards = briefSteps.reduce((a, s) => a + s.cards.length, 0);
  const cardStart = briefSteps.slice(0, idx).reduce((a, s) => a + s.cards.length, 0) + 1;
  return (
    <div className="np np-briefing-shell">
      <div className="np-brief-sidebar">
        <span className="np-eyebrow">Briefing</span>
        <strong className="np-serif np-brief-current">{briefingNav[idx]}</strong>
        <em className="np-brief-meta">Etapa {props.step} de {total} · {cardStart} de {totalCards} cards</em>
        <div className="np-brief-progress"><div style={{ width: `${(props.step / total) * 100}%` }} /></div>
        <nav className="np-brief-steps">
          {briefingNav.map((label, i) => (
            <button key={label} className={i + 1 === props.step ? "on" : i + 1 < props.step ? "done" : ""} onClick={() => props.setStep(i + 1)}>
              <span className="np-brief-num">{i + 1}</span>{label}
            </button>
          ))}
        </nav>
      </div>

      <div className="np-brief-main">
        <span className="np-eyebrow">{step.eyebrow} · Etapa {props.step} de {total}</span>
        <h2 className="np-serif np-brief-title">{step.titleA}<i>{step.titleB}</i></h2>
        {step.intro && <p className="np-brief-intro">{step.intro}</p>}
        <div className={`np-brief-cards ${step.cards.length > 1 ? "two" : "one"}`}>
          {step.cards.map((card) => {
            const cardDone = card.questions.every((_, qi) => String(props.answers[`${card.key}_q${qi + 1}`] ?? "").trim() !== "");
            return (
            <div className="np-brief-card" key={card.key}>
              <div className="np-brief-card-head">
                <strong className="np-serif">{card.title}</strong>
                <span className={`np-pill sm ${cardDone ? "green" : "gold"}`}>{cardDone ? "Concluído" : "Pendente"}</span>
              </div>
              <em className="np-brief-card-sub">Todos os campos são obrigatórios</em>
              {card.questions.map((q, qi) => {
                const key = `${card.key}_q${qi + 1}`;
                return (
                  <label className="np-brief-q" key={key}>
                    <span><i className="np-req">•</i> {q}</span>
                    <input value={String(props.answers[key] ?? "")} onChange={(e) => props.onAnswer(key, e.target.value)} placeholder="Escreva aqui..." />
                  </label>
                );
              })}
            </div>
            );
          })}
        </div>
        <div className="np-brief-nav">
          <button className="np-btn ghost" onClick={() => props.setStep(props.step - 1)}><Ico name="arrow-left" /> Anterior</button>
          <div className="np-brief-nav-right">
            <span className={`np-brief-chip ${props.chip === "Erro ao salvar" ? "error" : ""}`}>{props.chip || "Progresso salvo automaticamente"}</span>
            {props.step < total
              ? <button className="np-btn primary" onClick={() => props.setStep(props.step + 1)}>Próxima etapa <Ico name="arrow" /></button>
              : <button className="np-btn primary" onClick={props.onFinish}>Concluir briefing <Ico name="check" /></button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function CafePage(props: { onStart: () => void; onGo: (p: PageId) => void }) {
  return (
    <div className="np np-cafe">
      <header className="np-cafe-top">
        <button className="np-wordmark sm" onClick={() => props.onGo("inicio")}><span className="np-logo-dot" aria-hidden><CompassMark size={14} /></span>north</button>
        <span className="np-eyebrow">Briefing · Preparação</span>
      </header>
      <div className="np-cafe-body">
        <div className="np-cafe-left">
          <span className="np-eyebrow">Etapa 0 · Briefing</span>
          <h1 className="np-serif np-cafe-title">Pegue um café.</h1>
          <p className="np-serif np-cafe-sub">Vamos dar forma à sua marca.</p>
          <p className="np-cafe-desc">Reserve alguns minutos para contar o que move o seu negócio, seus objetivos e a rotina da operação. Quanto mais completas as respostas, mais fiel será a leitura do DNA da marca.</p>
        </div>
        <div className="np-cafe-right">
          <CoffeeCup />
          <strong className="np-serif">Pausa para o café.</strong>
          <p>Respire fundo. As próximas telas são um bate-papo sobre o seu negócio — sem pressa.</p>
          <button className="np-btn primary" onClick={props.onStart}>Começar o briefing <Ico name="arrow" /></button>
        </div>
      </div>
      <footer className="np-cafe-foot">
        <span>north · agência de marketing &amp; tráfego</span>
        <span className="np-eyebrow">Início do briefing</span>
      </footer>
    </div>
  );
}

function CoffeeCup() {
  return (
    <svg className="np-coffee" viewBox="0 0 200 170" role="img" aria-label="Xícara de café">
      <path d="M40 60 h95 v40 a40 40 0 0 1 -40 40 h-15 a40 40 0 0 1 -40 -40 z" className="np-coffee-body" />
      <path d="M135 70 h14 a20 20 0 0 1 0 40 h-8" className="np-coffee-handle" fill="none" />
      <ellipse cx="87" cy="150" rx="60" ry="8" className="np-coffee-saucer" fill="none" />
      <path d="M70 42 q-8 -12 0 -24" className="np-coffee-steam" fill="none" />
      <path d="M90 42 q-8 -12 0 -24" className="np-coffee-steam" fill="none" />
      <path d="M110 42 q-8 -12 0 -24" className="np-coffee-steam" fill="none" />
    </svg>
  );
}

/* ============================= Shared bits ============================= */

function PageHead(props: { eyebrow: string; title: ReactNode; lead: string }) {
  return (
    <div className="np-page-head">
      <span className="np-eyebrow">{props.eyebrow}</span>
      <h1 className="np-serif np-page-title">{props.title}</h1>
      <p className="np-page-lead">{props.lead}</p>
    </div>
  );
}

function Footer() {
  return (
    <footer className="np-footer">
      <button className="np-wordmark sm"><span className="np-logo-dot" aria-hidden><CompassMark size={14} /></span>north<em>PORTAL</em></button>
      <nav className="np-footer-links">
        <a href="/politica-de-privacidade">Política de Privacidade</a>
        <a href="/termos-de-uso">Termos de Uso</a>
        <a href="mailto:contato@north.test">Contato</a>
      </nav>
      <span className="np-footer-copy">© 2026 North. Todos os direitos reservados.</span>
    </footer>
  );
}

function Ico({ name }: { name: string }) {
  const s = { width: "1em", height: "1em", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (name) {
    case "menu": return <svg viewBox="0 0 24 24" {...s}><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
    case "close": return <svg viewBox="0 0 24 24" {...s}><path d="M6 6l12 12M18 6l-12 12" /></svg>;
    case "arrow": return <svg viewBox="0 0 24 24" {...s}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
    case "arrow-left": return <svg viewBox="0 0 24 24" {...s}><path d="M19 12H5M11 6l-6 6 6 6" /></svg>;
    case "check": return <svg viewBox="0 0 24 24" {...s}><path d="M5 13l4 4L19 7" /></svg>;
    case "moon": return <svg viewBox="0 0 24 24" {...s}><path d="M21 12.8A8 8 0 1 1 11.2 3a6 6 0 0 0 9.8 9.8z" /></svg>;
    case "sun": return <svg viewBox="0 0 24 24" {...s}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" /></svg>;
    case "diamond": return <svg viewBox="0 0 24 24" {...s} fill="currentColor" stroke="none"><path d="M12 3l7 9-7 9-7-9z" /></svg>;
    case "pencil": return <svg viewBox="0 0 24 24" {...s}><path d="M4 20h4L18 10l-4-4L4 16z M13 5l4 4" /></svg>;
    case "sign": return <svg viewBox="0 0 24 24" {...s}><path d="M3 20c4-1 5-9 8-9s2 5 5 5 4-4 5-4" /></svg>;
    case "grid": return <svg viewBox="0 0 24 24" {...s}><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 10h16M4 15h16M10 4v16" /></svg>;
    case "key": return <svg viewBox="0 0 24 24" {...s}><circle cx="8" cy="14" r="4" /><path d="M11 11l9-9M17 5l2 2M15 7l2 2" /></svg>;
    case "target": return <svg viewBox="0 0 24 24" {...s}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" /></svg>;
    case "folder": return <svg viewBox="0 0 24 24" {...s}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>;
    case "info": return <svg viewBox="0 0 24 24" {...s}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>;
    case "up": return <svg viewBox="0 0 24 24" {...s}><path d="M12 19V5M6 11l6-6 6 6" /></svg>;
    case "ring": return <svg viewBox="0 0 24 24" {...s}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></svg>;
    case "clock": return <svg viewBox="0 0 24 24" {...s}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
    case "book": return <svg viewBox="0 0 24 24" {...s}><path d="M4 5a2 2 0 0 1 2-2h6v18H6a2 2 0 0 1-2-2z" /><path d="M20 5a2 2 0 0 0-2-2h-6v18h6a2 2 0 0 0 2-2z" /></svg>;
    case "play": return <svg viewBox="0 0 24 24" {...s}><circle cx="12" cy="12" r="9" /><path d="M10 8.5l6 3.5-6 3.5z" fill="currentColor" stroke="none" /></svg>;
    case "lock": return <svg viewBox="0 0 24 24" {...s}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>;
    default: return null;
  }
}
