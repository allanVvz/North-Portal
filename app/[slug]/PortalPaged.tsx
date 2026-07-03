"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { useParams } from "next/navigation";
import type { PortalPayload } from "@/lib/validation";
import { briefSteps, folders } from "./content";

type SaveChip = "" | "Salvando..." | "Salvo" | "Erro ao salvar" | "Concluido";
type Direction = "N" | "NNE" | "NE" | "E" | "ESE" | "SSE" | "S" | "SSW" | "SW" | "W" | "NW";
type NavGroup = "inicio" | "cliente" | "north" | "performance";
type PageId =
  | "inicio"
  | "jornada"
  | "briefing"
  | "central"
  | "acessos"
  | "feedbacks"
  | "time-north"
  | "documentos"
  | "agenda"
  | "dashboard"
  | "plano-acao";

type NavItem = {
  label: string;
  page: PageId;
  group: NavGroup;
  direction: Direction;
  children?: NavItem[];
};

const NAV_ITEMS: NavItem[] = [
  { label: "Inicio", page: "inicio", group: "inicio", direction: "W" },
  {
    label: "Cliente",
    page: "jornada",
    group: "cliente",
    direction: "S",
    children: [
      { label: "Jornada & Onboarding", page: "jornada", group: "cliente", direction: "SSW" },
      { label: "Briefing Oficial", page: "briefing", group: "cliente", direction: "SW" },
      { label: "Central Comercial", page: "central", group: "cliente", direction: "S" },
      { label: "Acessos & Pastas", page: "acessos", group: "cliente", direction: "SSE" },
    ],
  },
  {
    label: "North",
    page: "feedbacks",
    group: "north",
    direction: "N",
    children: [
      { label: "Feedbacks", page: "feedbacks", group: "north", direction: "NE" },
      { label: "Time North", page: "time-north", group: "north", direction: "N" },
      { label: "Documentos", page: "documentos", group: "north", direction: "NNE" },
      { label: "Agenda", page: "agenda", group: "north", direction: "NW" },
    ],
  },
  {
    label: "Performance",
    page: "dashboard",
    group: "performance",
    direction: "E",
    children: [
      { label: "Dashboard", page: "dashboard", group: "performance", direction: "E" },
      { label: "Plano de Acao", page: "plano-acao", group: "performance", direction: "ESE" },
    ],
  },
];

const PAGE_GROUP: Record<PageId, NavGroup> = {
  inicio: "inicio",
  jornada: "cliente",
  briefing: "cliente",
  central: "cliente",
  acessos: "cliente",
  feedbacks: "north",
  "time-north": "north",
  documentos: "north",
  agenda: "north",
  dashboard: "performance",
  "plano-acao": "performance",
};

const PAGE_DIRECTION: Record<PageId, Direction> = {
  inicio: "W",
  jornada: "SSW",
  briefing: "SW",
  central: "S",
  acessos: "SSE",
  feedbacks: "NE",
  "time-north": "N",
  documentos: "NNE",
  agenda: "NW",
  dashboard: "E",
  "plano-acao": "ESE",
};

const DIRECTION_DEG: Record<Direction, number> = {
  N: 0,
  NNE: 22.5,
  NE: 45,
  E: 90,
  ESE: 112.5,
  SSE: 157.5,
  S: 180,
  SSW: 202.5,
  SW: 225,
  W: 270,
  NW: 315,
};

const allNavItems = NAV_ITEMS.flatMap((item) => [item, ...(item.children ?? [])]);
const pageIds = new Set<PageId>(Object.keys(PAGE_GROUP) as PageId[]);

function pageFromHash(): PageId {
  if (typeof window === "undefined") return "inicio";
  const hash = window.location.hash.replace("#", "");
  return pageIds.has(hash as PageId) ? (hash as PageId) : "inicio";
}

function pageHref(page: PageId) {
  return page === "inicio" ? "#" : `#${page}`;
}

function groupLabel(group: NavGroup) {
  return NAV_ITEMS.find((item) => item.group === group)?.label ?? "Inicio";
}

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
  const [activeDirection, setActiveDirection] = useState<Direction>("W");

  const loaded = useRef(false);
  const saveSeq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const syncPage = () => {
      const nextPage = pageFromHash();
      setActivePage(nextPage);
      setActiveDirection(PAGE_DIRECTION[nextPage]);
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    };
    syncPage();
    window.addEventListener("hashchange", syncPage);
    window.addEventListener("popstate", syncPage);
    return () => {
      window.removeEventListener("hashchange", syncPage);
      window.removeEventListener("popstate", syncPage);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenMenu(null);
        setOverlayOpen(false);
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (!headerRef.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle("menu-open", overlayOpen);
    return () => document.body.classList.remove("menu-open");
  }, [overlayOpen]);

  useEffect(() => {
    loaded.current = false;
    abortRef.current?.abort();
    setPageError("");
    setPayload(null);
    setChip("");
    fetch(`/api/client/${slug}`)
      .then(async (response) => {
        if (!response.ok) {
          if (response.status === 404) throw new Error("Cliente nao encontrado ou inativo.");
          return null;
        }
        return response.json() as Promise<PortalPayload>;
      })
      .then((data) => {
        if (!data) {
          loaded.current = true;
          return;
        }
        setPayload(data);
        setAnswers(data.briefing.answers ?? {});
        setChip(data.briefing.submitted ? "Concluido" : "");
        loaded.current = true;
      })
      .catch((error: Error) => {
        if (error.message.includes("Cliente")) setPageError(error.message);
        loaded.current = true;
      });
  }, [slug]);

  useEffect(() => {
    if (!loaded.current) return;
    const currentSeq = ++saveSeq.current;
    const timer = window.setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setChip("Salvando...");
      try {
        const response = await fetch(`/api/client/${slug}/briefing`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answers, submitted: payload?.briefing.submitted ?? false }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("save failed");
        const saved = await response.json();
        if (currentSeq === saveSeq.current) {
          setPayload((current) => (current ? { ...current, briefing: saved } : current));
          setChip(saved.submitted ? "Concluido" : "Salvo");
        }
      } catch (error) {
        if ((error as Error).name !== "AbortError" && currentSeq === saveSeq.current) setChip("Erro ao salvar");
      }
    }, 950);
    return () => window.clearTimeout(timer);
  }, [answers, payload?.briefing.submitted, slug]);

  const goTo = useCallback((item: NavItem) => {
    setTransitioning(true);
    setActiveDirection(item.direction);
    setOpenMenu(null);
    window.setTimeout(() => {
      setActivePage(item.page);
      window.history.pushState(null, "", pageHref(item.page));
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      setOverlayOpen(false);
      window.setTimeout(() => setTransitioning(false), 260);
    }, 280);
  }, []);

  const goToPage = useCallback((page: PageId) => {
    const item = allNavItems.find((navItem) => navItem.page === page) ?? NAV_ITEMS[0];
    goTo(item);
  }, [goTo]);

  const finishBriefing = useCallback(async () => {
    setChip("Salvando...");
    try {
      const response = await fetch(`/api/client/${slug}/briefing`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers, submitted: true }),
      });
      if (!response.ok) throw new Error("save failed");
      const saved = await response.json();
      setPayload((current) => (current ? { ...current, briefing: saved } : current));
      setChip("Concluido");
    } catch {
      setChip("Erro ao salvar");
    }
  }, [answers, slug]);

  const setAnswer = useCallback((key: string, value: string) => {
    setAnswers((current) => ({ ...current, [key]: value }));
  }, []);

  const activeGroup = PAGE_GROUP[activePage];
  const name = payload?.client.name ?? slug;
  const links = payload?.driveLinks;
  const metrics = payload?.results.topMetrics ?? [];
  const insights = payload?.results.insights ?? [];
  const reportUrl = payload?.results.reportUrl ?? null;
  const feedbackUrl = payload?.results.feedbackUrl ?? null;
  const currentGroupNav = NAV_ITEMS.find((item) => item.group === activeGroup);

  if (pageError) {
    return (
      <main className="fatal">
        <span className="eyebrow">Portal North</span>
        <h1>Portal indisponivel.</h1>
        <p>{pageError}</p>
        <p>Nao foi possivel carregar o portal agora. Tente novamente.</p>
      </main>
    );
  }

  return (
    <>
      <div className="accent-line" />
      <PortalHeader
        refEl={headerRef}
        activeGroup={activeGroup}
        activePage={activePage}
        openMenu={openMenu}
        setOpenMenu={setOpenMenu}
        onGo={goTo}
        onOpenOverlay={() => setOverlayOpen(true)}
      />
      <FullScreenMenu
        open={overlayOpen}
        activeDirection={activeDirection}
        activeGroup={activeGroup}
        currentGroupNav={currentGroupNav}
        onClose={() => setOverlayOpen(false)}
        onGo={goTo}
      />
      <div className={`route-veil ${transitioning ? "show" : ""}`} aria-hidden />

      <main className="portal-shell">
        {activePage === "inicio" ? (
          <section className="hero-screen" id="inicio">
            <div className="hero-copy">
              <span className="eyebrow">Portal do cliente</span>
              <h1>
                Portal <span>north</span>
              </h1>
              <p>
                Um espaco premium para orientar a parceria, reunir materiais e acompanhar entregas em paginas separadas.
                O briefing tem entrada propria e encaminhamentos claros.
              </p>
            </div>
            <div className="hero-compass">
              <Compass activeDirection={activeDirection} items={NAV_ITEMS} onGo={goTo} />
              <div className="hero-context">
                <span>{name}</span>
                <strong>{groupLabel(activeGroup)}</strong>
              </div>
            </div>
            <div className="hero-links" aria-label="Acessos principais">
              {NAV_ITEMS.map((item) => (
                <button key={item.label} onClick={() => goTo(item)} aria-current={activeGroup === item.group ? "page" : undefined}>
                  <span>{item.direction}</span>
                  {item.label}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {activePage === "jornada" ? (
          <Section kicker="Cliente / SSW" title="Jornada & Onboarding" lead="A jornada organiza contexto, materiais e combinados de trabalho. O briefing deixa de ficar abaixo da timeline e passa a ser a proxima pagina.">
            <div className="intro-grid">
              <EditorialCard title="Encaminhamento principal" eyebrow="Proxima pagina">
                <p>Depois da leitura inicial, avance para o briefing oficial em uma tela dedicada.</p>
                <button className="btn primary" onClick={() => goToPage("briefing")}>Abrir briefing</button>
              </EditorialCard>
              <EditorialCard title="Ritmo da parceria" eyebrow="Como funciona">
                <ul className="clean-list">
                  <li>Imersao e leitura do negocio.</li>
                  <li>Briefing oficial em pagina separada.</li>
                  <li>Planejamento, producao e acompanhamento.</li>
                </ul>
              </EditorialCard>
            </div>
            <PageActions back={{ label: "Voltar ao inicio", onClick: () => goToPage("inicio") }} next={{ label: "Responder briefing", onClick: () => goToPage("briefing") }} />
          </Section>
        ) : null}

        {activePage === "briefing" ? (
          <Section kicker="Cliente / SW" title="Briefing Oficial" lead="Uma pagina propria para responder sobre DNA do negocio, objetivos, publico, tom da marca, trafego e materiais essenciais.">
            <BriefingForm chip={chip} answers={answers} onAnswer={setAnswer} onFinish={finishBriefing} />
            <PageActions back={{ label: "Voltar a jornada", onClick: () => goToPage("jornada") }} next={{ label: "Ir para central comercial", onClick: () => goToPage("central") }} />
          </Section>
        ) : null}

        {activePage === "central" ? (
          <Section tone="cream" kicker="Cliente / S" title="Central Comercial" lead="Contratos, comprovantes e combinados comerciais em uma area discreta, clara e sem linguagem de cobranca operacional.">
            <div className="card-grid three">
              <InfoTile label="Escopo" title="Contrato e combinados" text="Consulte o que foi acordado para producao, trafego e acompanhamento." />
              <InfoTile label="Financeiro" title="Faturas e comprovantes" text="Guarde os registros comerciais da parceria em um ponto de referencia unico." />
              <InfoTile label="Aprovacao" title="Fluxo de retorno" text="Centralize observacoes por ciclo para preservar qualidade, prazo e contexto." />
            </div>
            <PageActions back={{ label: "Voltar ao briefing", onClick: () => goToPage("briefing") }} next={{ label: "Ver acessos e pastas", onClick: () => goToPage("acessos") }} />
          </Section>
        ) : null}

        {activePage === "acessos" ? (
          <Section kicker="Cliente / SSE" title="Acessos & Pastas" lead="A base de arquivos da marca precisa estar facil de encontrar, sem excesso de status ou linguagem de painel interno.">
            <div className="card-grid three">
              {folders.map((folder) => {
                const url = links ? links[folder.key] : null;
                return (
                  <EditorialCard key={folder.key} title={folder.title} eyebrow="Drive North">
                    <ul className="clean-list">
                      {folder.items.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                    {url ? (
                      <a className="btn secondary" href={url} target="_blank" rel="noopener noreferrer">Abrir pasta</a>
                    ) : (
                      <span className="quiet-state">Material ainda nao disponivel.</span>
                    )}
                  </EditorialCard>
                );
              })}
            </div>
            <PageActions back={{ label: "Voltar a central", onClick: () => goToPage("central") }} next={{ label: "Ir para feedbacks", onClick: () => goToPage("feedbacks") }} />
          </Section>
        ) : null}

        {activePage === "feedbacks" ? (
          <Section tone="cream" kicker="North / NE" title="Feedbacks" lead="Um canal simples para registrar percepcoes da parceria e manter os proximos ciclos alinhados ao que importa.">
            <div className="split-grid">
              <EditorialCard title="Feedback da parceria" eyebrow="Escuta ativa">
                <p>Registre elogios, pontos de ajuste e observacoes sobre o trabalho em andamento.</p>
                {feedbackUrl ? <a className="btn primary" href={feedbackUrl} target="_blank" rel="noopener noreferrer">Enviar feedback</a> : <span className="quiet-state">Formulario ainda nao disponivel.</span>}
              </EditorialCard>
              <EditorialCard title="Historico de alinhamento" eyebrow="Leitura North">
                <p>As conversas importantes viram insumo para conteudo, atendimento e performance.</p>
              </EditorialCard>
            </div>
            <PageActions back={{ label: "Voltar aos acessos", onClick: () => goToPage("acessos") }} next={{ label: "Conhecer time North", onClick: () => goToPage("time-north") }} />
          </Section>
        ) : null}

        {activePage === "time-north" ? (
          <Section kicker="North / N" title="Time North" lead="Quem conduz a operacao aparece com papel claro, sem transformar a tela em organograma tecnico.">
            <div className="team-grid">
              {[
                ["Estrategia", "Define direcao, prioridades e narrativa."],
                ["Conteudo", "Transforma briefing em roteiro, pauta e criativos."],
                ["Trafego", "Cuida de campanhas, leitura de dados e otimizacao."],
                ["Atendimento", "Mantem o fluxo organizado entre cliente e North."],
              ].map(([role, text]) => (
                <div className="team-card" key={role}>
                  <span>{role.charAt(0)}</span>
                  <h3>{role}</h3>
                  <p>{text}</p>
                </div>
              ))}
            </div>
            <PageActions back={{ label: "Voltar aos feedbacks", onClick: () => goToPage("feedbacks") }} next={{ label: "Abrir documentos", onClick: () => goToPage("documentos") }} />
          </Section>
        ) : null}

        {activePage === "documentos" ? (
          <Section tone="cream" kicker="North / NNE" title="Documentos" lead="Relatorios, documentos e referencias importantes ficam reunidos em uma biblioteca enxuta.">
            <div className="card-grid three">
              <EditorialCard title="Relatorio completo" eyebrow="Performance">
                <p>A leitura consolidada do ciclo, quando publicada pela North.</p>
                {reportUrl ? <a className="btn primary" href={reportUrl} target="_blank" rel="noopener noreferrer">Abrir relatorio</a> : <span className="quiet-state">Relatorio ainda nao publicado.</span>}
              </EditorialCard>
              <EditorialCard title="Materiais da marca" eyebrow="Identidade">
                <p>Arquivos-base para manter consistencia visual e verbal.</p>
                {links?.brandUrl ? <a className="btn secondary" href={links.brandUrl} target="_blank" rel="noopener noreferrer">Abrir materiais</a> : <span className="quiet-state">Material ainda nao disponivel.</span>}
              </EditorialCard>
              <EditorialCard title="Produtos e ofertas" eyebrow="Comercial">
                <p>Referencias de servicos, catalogo, condicoes e diferenciais.</p>
                {links?.productsUrl ? <a className="btn secondary" href={links.productsUrl} target="_blank" rel="noopener noreferrer">Abrir referencias</a> : <span className="quiet-state">Material ainda nao disponivel.</span>}
              </EditorialCard>
            </div>
            <PageActions back={{ label: "Voltar ao time", onClick: () => goToPage("time-north") }} next={{ label: "Ver agenda", onClick: () => goToPage("agenda") }} />
          </Section>
        ) : null}

        {activePage === "agenda" ? (
          <Section kicker="North / NW" title="Agenda" lead="A agenda mostra o ritmo de colaboracao, com foco em momentos de decisao e alinhamento.">
            <div className="timeline">
              {[
                ["Imersao", "Briefing, materiais e leitura inicial."],
                ["Planejamento", "Definicao de pauta, narrativa e criativos."],
                ["Producao", "Gravacoes, edicoes e organizacao das entregas."],
                ["Leitura", "Relatorio, aprendizados e proximo ciclo."],
              ].map(([title, text], index) => (
                <div className="timeline-item" key={title}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              ))}
            </div>
            <PageActions back={{ label: "Voltar aos documentos", onClick: () => goToPage("documentos") }} next={{ label: "Abrir dashboard", onClick: () => goToPage("dashboard") }} />
          </Section>
        ) : null}

        {activePage === "dashboard" ? (
          <Section tone="cream" kicker="Performance / E" title="Dashboard" lead="Resultados reais entram aqui quando publicados. A interface nao inventa numeros e nao cria sensacao artificial de urgencia.">
            {metrics.length ? (
              <div className="metric-grid">
                {metrics.slice(0, 4).map((metric) => (
                  <div className="metric-card" key={`${metric.label}-${metric.value}`}>
                    <span>{metric.label}</span>
                    <strong>{metric.value}</strong>
                    {metric.variation ? <em>{metric.variation}</em> : null}
                    {metric.description ? <p>{metric.description}</p> : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">Os resultados ainda nao foram publicados.</div>
            )}
            <div className="insight-list">
              <h3>Insights do ciclo</h3>
              {insights.length ? (
                insights.map((insight) => (
                  <article key={`${insight.title}-${insight.date ?? ""}`}>
                    <span>{[insight.category, insight.date].filter(Boolean).join(" / ") || "Insight"}</span>
                    <strong>{insight.title}</strong>
                    <p>{insight.description}</p>
                  </article>
                ))
              ) : (
                <p>Nenhum insight publicado ate o momento.</p>
              )}
            </div>
            <PageActions back={{ label: "Voltar a agenda", onClick: () => goToPage("agenda") }} next={{ label: "Ver plano de acao", onClick: () => goToPage("plano-acao") }} />
          </Section>
        ) : null}

        {activePage === "plano-acao" ? (
          <Section kicker="Performance / ESE" title="Plano de Acao" lead="Esta area existe como direcao estrategica, nao como bloco operacional na capa.">
            <div className="split-grid">
              <EditorialCard title="Direcao do proximo ciclo" eyebrow="Estrategia">
                <p>O plano sintetiza foco, criterio de decisao e prioridades quando a North publicar a leitura do ciclo.</p>
              </EditorialCard>
              <EditorialCard title="Sem checklist operacional" eyebrow="Principio da tela">
                <p>A capa permanece limpa. Itens de execucao ficam contextualizados dentro das paginas correspondentes.</p>
              </EditorialCard>
            </div>
            <PageActions back={{ label: "Voltar ao dashboard", onClick: () => goToPage("dashboard") }} next={{ label: "Retornar ao inicio", onClick: () => goToPage("inicio") }} />
          </Section>
        ) : null}
      </main>
    </>
  );
}

function PortalHeader(props: {
  refEl: MutableRefObject<HTMLElement | null>;
  activeGroup: NavGroup;
  activePage: PageId;
  openMenu: NavGroup | null;
  setOpenMenu: (group: NavGroup | null) => void;
  onGo: (item: NavItem) => void;
  onOpenOverlay: () => void;
}) {
  return (
    <header className="global-header" ref={props.refEl}>
      <button className="brand-lockup" onClick={() => props.onGo(NAV_ITEMS[0])}>
        <span className="brand-mark">n</span>
        <span>
          <strong>north</strong>
          <em>Portal</em>
        </span>
      </button>
      <nav className="desktop-nav" aria-label="Navegacao principal">
        {NAV_ITEMS.map((item) => (
          <div className="nav-cluster" key={item.label} onMouseEnter={() => props.setOpenMenu(item.group)} onFocus={() => props.setOpenMenu(item.group)}>
            <button
              className={props.activeGroup === item.group ? "active" : ""}
              aria-expanded={item.children ? props.openMenu === item.group : undefined}
              aria-controls={item.children ? `dropdown-${item.group}` : undefined}
              aria-current={props.activeGroup === item.group ? "page" : undefined}
              onClick={() => (item.children ? props.setOpenMenu(props.openMenu === item.group ? null : item.group) : props.onGo(item))}
            >
              {item.label}
              {item.children ? <span aria-hidden>v</span> : null}
            </button>
            {item.children ? (
              <div className={`nav-dropdown ${props.openMenu === item.group ? "open" : ""}`} id={`dropdown-${item.group}`} onMouseLeave={() => props.setOpenMenu(null)}>
                <strong>{item.label}</strong>
                {item.children.map((child) => (
                  <button key={child.label} onClick={() => props.onGo(child)} aria-current={props.activePage === child.page ? "page" : undefined}>
                    <span>{child.label}</span>
                    <em>{child.direction}</em>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </nav>
      <div className="header-actions">
        <a className="header-logout" href="/logout">Sair</a>
        <button className="menu-trigger" aria-label="Abrir menu full-screen" onClick={props.onOpenOverlay}>
          <i />
          <i />
          <i />
          <span>Menu</span>
        </button>
      </div>
    </header>
  );
}

function FullScreenMenu(props: {
  open: boolean;
  activeDirection: Direction;
  activeGroup: NavGroup;
  currentGroupNav?: NavItem;
  onClose: () => void;
  onGo: (item: NavItem) => void;
}) {
  return (
    <aside className={`fullscreen-menu ${props.open ? "open" : ""}`} aria-hidden={!props.open}>
      <div className="menu-topline">
        <strong>North Portal</strong>
        <button onClick={props.onClose}>Fechar</button>
      </div>
      <div className="menu-compass">
        <Compass activeDirection={props.activeDirection} items={allNavItems} onGo={props.onGo} large />
        <span>{props.activeDirection}</span>
        <h2>{props.currentGroupNav?.label ?? "Inicio"}</h2>
        <p>A bussola organiza a navegacao por destino. Cada escolha abre uma pagina propria dentro do portal.</p>
      </div>
      <div className="menu-main-links">
        {NAV_ITEMS.map((item) => (
          <button key={item.label} onClick={() => props.onGo(item)} aria-current={props.activeGroup === item.group ? "page" : undefined}>
            <span>{item.direction}</span>
            {item.label}
          </button>
        ))}
      </div>
      {props.currentGroupNav?.children ? (
        <div className="menu-context-links">
          <strong>{props.currentGroupNav.label}</strong>
          {props.currentGroupNav.children.map((child) => (
            <button key={child.label} onClick={() => props.onGo(child)}>
              {child.label}
              <span>{child.direction}</span>
            </button>
          ))}
        </div>
      ) : null}
    </aside>
  );
}

function Compass(props: { activeDirection: Direction; items: NavItem[]; onGo: (item: NavItem) => void; large?: boolean }) {
  const deg = DIRECTION_DEG[props.activeDirection] ?? 0;
  const uniqueItems = useMemo(() => {
    const seen = new Set<string>();
    return props.items.filter((item) => {
      const key = `${item.page}-${item.direction}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [props.items]);

  return (
    <svg className={`north-compass ${props.large ? "large" : ""}`} viewBox="0 0 420 420" role="img" aria-label={`Bussola ativa em ${props.activeDirection}`}>
      <circle className="compass-ring outer" cx="210" cy="210" r="184" />
      <circle className="compass-ring inner" cx="210" cy="210" r="132" />
      <line className="compass-axis" x1="210" y1="34" x2="210" y2="386" />
      <line className="compass-axis" x1="34" y1="210" x2="386" y2="210" />
      <line className="compass-axis soft" x1="86" y1="86" x2="334" y2="334" />
      <line className="compass-axis soft" x1="334" y1="86" x2="86" y2="334" />
      {(["N", "E", "S", "W"] as Direction[]).map((dir) => {
        const point = compassPoint(DIRECTION_DEG[dir], 168);
        return (
          <text key={dir} className="compass-label" x={point.x} y={point.y} dominantBaseline="middle" textAnchor="middle">
            {dir}
          </text>
        );
      })}
      <g className="compass-needle" style={{ transform: `rotate(${deg}deg)`, transformOrigin: "210px 210px" }}>
        <polygon className="needle-main" points="210,58 226,210 194,210" />
        <polygon className="needle-tail" points="210,362 226,210 194,210" />
      </g>
      <circle className="compass-hub" cx="210" cy="210" r="22" />
      <text className="hub-letter" x="210" y="217" textAnchor="middle">N</text>
      {uniqueItems.map((item) => {
        const point = compassPoint(DIRECTION_DEG[item.direction], 142);
        const active = item.direction === props.activeDirection;
        return (
          <g
            className={`compass-target ${active ? "active" : ""}`}
            key={`${item.page}-${item.direction}`}
            onClick={() => props.onGo(item)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") props.onGo(item);
            }}
            role="button"
            tabIndex={0}
            aria-label={`${item.label} ${item.direction}`}
          >
            <circle cx={point.x} cy={point.y} r="15" />
            <text x={point.x} y={point.y + 4} textAnchor="middle">{item.direction.length > 1 ? "." : item.direction}</text>
          </g>
        );
      })}
    </svg>
  );
}

function compassPoint(deg: number, radius: number) {
  const angle = ((deg - 90) * Math.PI) / 180;
  return {
    x: Number((210 + Math.cos(angle) * radius).toFixed(2)),
    y: Number((210 + Math.sin(angle) * radius).toFixed(2)),
  };
}

function Section(props: { kicker: string; title: string; lead: string; tone?: "dark" | "cream"; children: ReactNode }) {
  return (
    <section className={`portal-section ${props.tone === "cream" ? "cream-section" : ""}`}>
      <div className="section-head">
        <span className="eyebrow">{props.kicker}</span>
        <h2>{props.title}</h2>
        <p>{props.lead}</p>
      </div>
      {props.children}
    </section>
  );
}

function EditorialCard(props: { title: string; eyebrow: string; children: ReactNode }) {
  return (
    <article className="editorial-card">
      <span>{props.eyebrow}</span>
      <h3>{props.title}</h3>
      {props.children}
    </article>
  );
}

function InfoTile(props: { label: string; title: string; text: string }) {
  return (
    <article className="info-tile">
      <span>{props.label}</span>
      <h3>{props.title}</h3>
      <p>{props.text}</p>
    </article>
  );
}

function PageActions(props: {
  back: { label: string; onClick: () => void };
  next: { label: string; onClick: () => void };
}) {
  return (
    <nav className="page-actions" aria-label="Encaminhamentos">
      <button className="btn secondary" onClick={props.back.onClick}>{props.back.label}</button>
      <button className="btn primary" onClick={props.next.onClick}>{props.next.label}</button>
    </nav>
  );
}

function BriefingForm(props: {
  chip: SaveChip;
  answers: Record<string, unknown>;
  onAnswer: (key: string, value: string) => void;
  onFinish: () => void;
}) {
  return (
    <div className="briefing-area">
      <div className="briefing-head">
        <div>
          <span className="eyebrow">Briefing oficial</span>
          <h3>Dar forma a marca</h3>
        </div>
        {props.chip ? <span className={`save-pill ${props.chip === "Erro ao salvar" ? "error" : ""}`}>{props.chip}</span> : null}
      </div>
      <div className="briefing-grid">
        {briefSteps.map((step, index) => (
          <article className="briefing-step" key={step.cards[0].key}>
            <span>{String(index + 1).padStart(2, "0")} / {step.eyebrow}</span>
            <h4>{step.titleA}<em>{step.titleB}</em></h4>
            {step.intro ? <p>{step.intro}</p> : null}
            {step.cards.map((card) => (
              <fieldset className="answer-card" key={card.key}>
                <legend>{card.title}</legend>
                {card.questions.map((question, qi) => {
                  const key = `${card.key}_q${qi + 1}`;
                  return (
                    <label className="answer-field" key={key}>
                      <strong>
                        {question} <span className="req" aria-hidden>*</span>
                      </strong>
                      <textarea
                        value={String(props.answers[key] ?? "")}
                        onChange={(event) => props.onAnswer(key, event.target.value)}
                        placeholder="Escreva sua resposta aqui..."
                        rows={3}
                      />
                    </label>
                  );
                })}
              </fieldset>
            ))}
          </article>
        ))}
      </div>
      <div className="briefing-actions">
        <button className="btn primary" onClick={props.onFinish}>Concluir briefing</button>
      </div>
    </div>
  );
}
