"use client";

// Manual do Cliente — 11-slide onboarding deck, sourced from the Figma
// "06 · MANUAL COMPLETO" section (node 178:299). Renders as a fixed
// full-screen overlay (covers the portal header/nav, no need to lift state
// to the root component) with its own dark/light per-slide theme — the
// manual is a "printed document", it doesn't follow the portal's own
// light/dark toggle.

import { useCallback, useEffect, useState } from "react";

type Theme = "dark" | "light";

type CoverSlide = {
  kind: "cover";
  theme: Theme;
  kicker: string;
  title: [string, string];
  desc: string;
  cta?: { label: string; kind: "briefing" | "finish" };
};
type PhoneBulletsSlide = {
  kind: "phoneBullets";
  theme: Theme;
  title: string;
  subtitle: string;
  bullets: string[];
  phone: { handle: string; caption: string; sub: string };
};
type GridBannerSlide = {
  kind: "gridBanner";
  theme: Theme;
  kicker: string;
  title: string;
  subtitle?: string;
  cards: { n: string; title: string; desc: string }[];
  banner?: { kicker: string; text: string };
};
type LightChecklistSlide = {
  kind: "lightChecklist";
  theme: Theme;
  kicker: string;
  title: [string, string?];
  desc: string;
  columns: 1 | 2;
  items: { title: string; desc: string }[];
  quote?: string;
  cta?: { label: string; kind: "briefing" };
};
type TimelineSlide = {
  kind: "timeline";
  theme: Theme;
  kicker: string;
  title: string;
  points: { label: string; text: string; row: "top" | "bottom" }[];
};
type TwoColumnListSlide = {
  kind: "twoColumnList";
  theme: Theme;
  kicker: string;
  title: string;
  columns: { heading: string; items: string[] }[];
};
type InfoBulletsSlide = {
  kind: "infoBullets";
  theme: Theme;
  title: string;
  hours: { prefix: string; bold: string; time: string };
  title2: string;
  bullets: string[];
};

type ManualSlide =
  | CoverSlide
  | PhoneBulletsSlide
  | GridBannerSlide
  | LightChecklistSlide
  | TimelineSlide
  | TwoColumnListSlide
  | InfoBulletsSlide;

const MANUAL_SLIDES: ManualSlide[] = [
  {
    kind: "cover",
    theme: "dark",
    kicker: "Manual de onboarding",
    title: ["Manual", "do cliente"],
    desc: "Seu ponto de partida com a north. O caminho, as boas práticas e o que esperar de cada etapa da nossa parceria.",
  },
  {
    kind: "phoneBullets",
    theme: "dark",
    title: "Olá, cliente!",
    subtitle: "Que bom ter você por aqui.",
    bullets: [
      "Parabéns pela decisão. Você acaba de dar um passo importante para fortalecer o posicionamento do seu negócio.",
      "A partir de agora, nossa equipe assume a produção de conteúdo e a gestão de tráfego do seu perfil.",
      "Este manual mostra a jornada completa — do briefing aos resultados — e as boas práticas que deixam tudo mais fluido.",
    ],
    phone: { handle: "Northestrategia", caption: "Clareza comercial é vantagem competitiva.", sub: "Posicionamento, conteúdo e mídia com direção." },
  },
  {
    kind: "gridBanner",
    theme: "dark",
    kicker: "O que a north assume",
    title: "Quatro frentes, uma direção.",
    subtitle: "Estratégia, conteúdo, mídia e atendimento trabalham como um único sistema.",
    cards: [
      { n: "01", title: "Estratégia", desc: "Define prioridades, mensagem, posicionamento e ritmo de execução." },
      { n: "02", title: "Conteúdo", desc: "Transforma a estratégia em narrativas, roteiros, peças e publicações." },
      { n: "03", title: "Mídia", desc: "Distribui, testa e otimiza campanhas para aproximar a marca das pessoas certas." },
      { n: "04", title: "Atendimento", desc: "Centraliza alinhamentos, prazos, aprovações e contexto da operação." },
    ],
    banner: { kicker: "Uma operação integrada", text: "Estratégia orienta o conteúdo. Conteúdo alimenta a mídia. Atendimento mantém o contexto e o projeto avançando." },
  },
  {
    kind: "lightChecklist",
    theme: "light",
    kicker: "Por que este manual existe",
    title: ["Clareza para", "trabalhar melhor."],
    desc: "Dar visibilidade à jornada, reduzir dúvidas e deixar claras as boas práticas que mantêm o projeto avançando.",
    columns: 1,
    items: [
      { title: "Visibilidade da jornada", desc: "Você sabe o que acontece em cada etapa e o que esperar da equipe." },
      { title: "Menos dúvidas e retrabalho", desc: "Responsabilidades, prazos e canais ficam definidos desde o início." },
      { title: "Decisões mais rápidas", desc: "Com o mesmo contexto, aprovações e ajustes acontecem com mais segurança." },
    ],
    quote: "Nosso trabalho funciona melhor quando todos enxergam o mesmo caminho.",
  },
  {
    kind: "lightChecklist",
    theme: "light",
    kicker: "Antes de começar",
    title: ["Checklist do cliente"],
    desc: "Tudo o que precisamos em mãos para colocar a estratégia em movimento.",
    columns: 2,
    items: [
      { title: "Contrato assinado", desc: "" },
      { title: "Pagamento confirmado", desc: "" },
      { title: "Briefing respondido", desc: "" },
      { title: "Acesso ao Gerenciador de Anúncios", desc: "" },
      { title: "Fotos e vídeos do negócio", desc: "" },
      { title: "Logins das redes sociais", desc: "" },
      { title: "Identidade visual", desc: "" },
      { title: "Admin da página do Facebook", desc: "" },
    ],
    cta: { label: "Responder briefing →", kind: "briefing" },
  },
  {
    kind: "gridBanner",
    theme: "dark",
    kicker: "O processo",
    title: "Como vai funcionar?",
    cards: [
      { n: "01", title: "Imersão", desc: "Mergulhamos no seu negócio. Quanto mais completo o briefing, mais certeira fica a estratégia." },
      { n: "02", title: "Alinhamento", desc: "Encontros de alinhamento e apresentação prévia dos roteiros, antes de qualquer gravação." },
      { n: "03", title: "Entrega", desc: "Os conteúdos chegam via Google Drive e WhatsApp para a sua aprovação." },
    ],
  },
  {
    kind: "timeline",
    theme: "dark",
    kicker: "As primeiras quatro semanas",
    title: "Cronograma",
    points: [
      { label: "S0", text: "Briefing e acessos às redes sociais.", row: "top" },
      { label: "S1", text: "Kickoff, roteirização, gravação e início das campanhas de perfil.", row: "bottom" },
      { label: "S2", text: "Edição e início das campanhas para WhatsApp.", row: "top" },
      { label: "S3", text: "Publicação dos conteúdos aprovados.", row: "bottom" },
      { label: "S4", text: "Reunião de métricas e ajustes do primeiro mês.", row: "top" },
    ],
  },
  {
    kind: "lightChecklist",
    theme: "light",
    kicker: "Para ir mais longe",
    title: ["Recomendações", "de sucesso"],
    desc: "Pequenos hábitos do seu lado que multiplicam os resultados do nosso trabalho.",
    columns: 1,
    items: [
      { title: "Rotina de Stories", desc: "Mostre o serviço por dentro com frequência — o bastidor aproxima e converte." },
      { title: "Planilha em dia", desc: "Preencha diariamente a planilha de acompanhamento. Dado registrado é decisão mais rápida." },
      { title: "Presença na comunidade", desc: "Use o grupo de WhatsApp e participe dos encontros. A parceria funciona em via dupla." },
    ],
  },
  {
    kind: "twoColumnList",
    theme: "dark",
    kicker: "Quem cuida de quê",
    title: "Deveres da parceria",
    columns: [
      {
        heading: "Equipe north",
        items: [
          "Planejamento e produção dos posts",
          "Gravação dos conteúdos",
          "Legendas e copy",
          "Criativos para anúncios",
          "Gestão de tráfego pago",
          "Relatórios de desempenho",
          "Aprovações e alterações",
        ],
      },
      {
        heading: "Cliente",
        items: [
          "Acessos às plataformas",
          "Número de WhatsApp dedicado",
          "Preenchimento das planilhas",
          "Envio de materiais e fotos",
          "Presença em reuniões e gravações",
          "Organização dos serviços a gravar",
        ],
      },
    ],
  },
  {
    kind: "infoBullets",
    theme: "dark",
    title: "Horário de atendimento",
    hours: { prefix: "Pelo WhatsApp, ", bold: "segunda a sexta", time: "8h — 18h" },
    title2: "Prazos, limites e extras",
    bullets: [
      "Aprovação dos conteúdos em até 1 dia útil.",
      "Até 2 rodadas de alteração por vídeo.",
      "Reúna todas as observações em um único retorno.",
    ],
  },
  {
    kind: "cover",
    theme: "dark",
    kicker: "É hora de começar",
    title: ["Você está pronto para", "se posicionar?"],
    desc: "A mudança começa agora. Bora?",
    cta: { label: "Concluir manual", kind: "finish" },
  },
];

function Check() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

function MiniCompassMark() {
  return (
    <svg className="manual-compass" viewBox="0 0 220 220" width="150" height="150" aria-hidden>
      <circle className="mc-ring" cx="110" cy="110" r="96" />
      <circle className="mc-ring soft" cx="110" cy="110" r="60" />
      {[0, 90, 180, 270].map((d) => {
        const a = ((d - 90) * Math.PI) / 180;
        const x = 110 + Math.cos(a) * 84;
        const y = 110 + Math.sin(a) * 84;
        return <circle key={d} className="mc-dot" cx={x} cy={y} r="3.5" />;
      })}
      <g className="mc-needle">
        <polygon className="mc-needle-n" points="110,34 119,110 101,110" />
        <polygon className="mc-needle-s" points="110,186 119,110 101,110" />
      </g>
      <circle className="mc-hub" cx="110" cy="110" r="7" />
    </svg>
  );
}

function Reveal({ i, children, className }: { i: number; children?: React.ReactNode; className?: string }) {
  return (
    <div className={className} style={{ animationDelay: `${i * 70}ms` }}>
      {children}
    </div>
  );
}

function SlideBody({
  slide,
  onBriefing,
  onFinish,
  clientName,
}: {
  slide: ManualSlide;
  onBriefing: () => void;
  onFinish: () => void;
  clientName: string;
}) {
  if (slide.kind === "cover") {
    return (
      <div className="manual-cover">
        <Reveal i={0} className="manual-reveal">
          <span className="manual-kicker">{slide.kicker}</span>
        </Reveal>
        <Reveal i={1} className="manual-reveal">
          <h1 className="manual-cover-title">
            {slide.title[0]} <i>{slide.title[1]}</i>
          </h1>
        </Reveal>
        <Reveal i={2} className="manual-reveal manual-cover-desc">
          <p>{slide.desc}</p>
        </Reveal>
        {slide.cta ? (
          <Reveal i={3} className="manual-reveal">
            <button className="manual-btn primary" onClick={slide.cta.kind === "finish" ? onFinish : onBriefing}>
              {slide.cta.label}
            </button>
          </Reveal>
        ) : null}
        <div className="manual-cover-compass"><MiniCompassMark /></div>
        <div className="manual-cover-foot">
          <span className="manual-wordmark">north</span>
          <em>agência de marketing &amp; tráfego</em>
        </div>
      </div>
    );
  }

  if (slide.kind === "phoneBullets") {
    return (
      <div className="manual-phonebullets">
        <Reveal i={0} className="manual-reveal manual-phone">
          <div className="manual-phone-shell">
            <div className="manual-phone-head">
              <span className="manual-phone-avatar" aria-hidden />
              <div><strong>{slide.phone.handle}</strong><em>Marketing · Tráfego</em></div>
            </div>
            <div className="manual-phone-post">
              <span className="manual-phone-mark">north</span>
              <p>{slide.phone.caption}</p>
            </div>
            <p className="manual-phone-sub">{slide.phone.sub}</p>
          </div>
        </Reveal>
        <div className="manual-phonebullets-text">
          <Reveal i={1} className="manual-reveal"><h2 className="manual-title-lg">{slide.title === "Olá, cliente!" ? `Olá, ${clientName}!` : slide.title}</h2></Reveal>
          <Reveal i={2} className="manual-reveal"><p className="manual-subtitle-italic">{slide.subtitle}</p></Reveal>
          {slide.bullets.map((b, i) => (
            <Reveal key={b} i={3 + i} className="manual-reveal manual-bullet">
              <span className="manual-bullet-mark" aria-hidden />
              <p>{b}</p>
            </Reveal>
          ))}
        </div>
      </div>
    );
  }

  if (slide.kind === "gridBanner") {
    return (
      <div className="manual-gridbanner">
        <Reveal i={0} className="manual-reveal"><span className="manual-kicker">{slide.kicker}</span></Reveal>
        <Reveal i={1} className="manual-reveal"><h2 className="manual-title-lg">{slide.title}</h2></Reveal>
        {slide.subtitle ? <Reveal i={2} className="manual-reveal"><p className="manual-lead">{slide.subtitle}</p></Reveal> : null}
        <div className="manual-grid" data-cols={slide.cards.length}>
          {slide.cards.map((c, i) => (
            <Reveal key={c.n} i={3 + i} className="manual-reveal manual-grid-card">
              <span className="manual-grid-n">{c.n}</span>
              <strong>{c.title}</strong>
              <p>{c.desc}</p>
            </Reveal>
          ))}
        </div>
        {slide.banner ? (
          <Reveal i={3 + slide.cards.length} className="manual-reveal manual-banner">
            <span className="manual-banner-kicker">{slide.banner.kicker}</span>
            <p>{slide.banner.text}</p>
          </Reveal>
        ) : null}
      </div>
    );
  }

  if (slide.kind === "lightChecklist") {
    return (
      <div className="manual-lightchecklist">
        <div className="manual-lc-intro">
          <Reveal i={0} className="manual-reveal"><span className="manual-kicker">{slide.kicker}</span></Reveal>
          <Reveal i={1} className="manual-reveal">
            <h2 className="manual-title-lg">
              {slide.title[0]}{slide.title[1] ? <><br /><i>{slide.title[1]}</i></> : null}
            </h2>
          </Reveal>
          <Reveal i={2} className="manual-reveal"><p className="manual-lead">{slide.desc}</p></Reveal>
        </div>
        <div className="manual-lc-items" data-cols={slide.columns}>
          {slide.items.map((it, i) => (
            <Reveal key={it.title} i={3 + i} className="manual-reveal manual-lc-item">
              <span className="manual-lc-check"><Check /></span>
              <div>
                <strong>{it.title}</strong>
                {it.desc ? <p>{it.desc}</p> : null}
              </div>
            </Reveal>
          ))}
        </div>
        {slide.quote ? <Reveal i={4 + slide.items.length} className="manual-reveal manual-quote"><p>&ldquo;{slide.quote}&rdquo;</p></Reveal> : null}
        {slide.cta ? (
          <Reveal i={5 + slide.items.length} className="manual-reveal">
            <button className="manual-btn primary sm manual-lc-cta" onClick={onBriefing}>{slide.cta.label}</button>
          </Reveal>
        ) : null}
      </div>
    );
  }

  if (slide.kind === "timeline") {
    return (
      <div className="manual-timeline">
        <Reveal i={0} className="manual-reveal"><span className="manual-kicker center">{slide.kicker}</span></Reveal>
        <Reveal i={1} className="manual-reveal"><h2 className="manual-title-lg center">{slide.title}</h2></Reveal>
        <div className="manual-tl-track">
          <div className="manual-tl-line" aria-hidden />
          {slide.points.map((p, i) => (
            <Reveal key={p.label} i={2 + i} className={`manual-reveal manual-tl-point row-${p.row}`}>
              {p.row === "top" ? (
                <>
                  <div className="manual-tl-text"><strong>{p.label}</strong><p>{p.text}</p></div>
                  <span className="manual-tl-dot" aria-hidden />
                </>
              ) : (
                <>
                  <span className="manual-tl-dot" aria-hidden />
                  <div className="manual-tl-text"><strong>{p.label}</strong><p>{p.text}</p></div>
                </>
              )}
            </Reveal>
          ))}
        </div>
      </div>
    );
  }

  if (slide.kind === "twoColumnList") {
    return (
      <div className="manual-twocol">
        <Reveal i={0} className="manual-reveal manual-diamond" />
        <Reveal i={1} className="manual-reveal"><span className="manual-kicker center">{slide.kicker}</span></Reveal>
        <Reveal i={2} className="manual-reveal"><h2 className="manual-title-lg center">{slide.title}</h2></Reveal>
        <div className="manual-twocol-grid">
          {slide.columns.map((col, ci) => (
            <div className="manual-twocol-col" key={col.heading}>
              <Reveal i={3 + ci} className="manual-reveal"><h3 className="manual-twocol-heading">{col.heading}</h3></Reveal>
              {col.items.map((it, i) => (
                <Reveal key={it} i={4 + ci + i} className="manual-reveal manual-twocol-item">
                  <span aria-hidden>◆</span><p>{it}</p>
                </Reveal>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // infoBullets
  return (
    <div className="manual-infobullets">
      <Reveal i={0} className="manual-reveal"><h2 className="manual-title-lg">{slide.title}</h2></Reveal>
      <Reveal i={1} className="manual-reveal manual-ib-hours">
        <span>{slide.hours.prefix}<strong>{slide.hours.bold}</strong></span>
        <em>{slide.hours.time}</em>
      </Reveal>
      <Reveal i={2} className="manual-reveal"><h2 className="manual-title-lg">{slide.title2}</h2></Reveal>
      {slide.bullets.map((b, i) => (
        <Reveal key={b} i={3 + i} className="manual-reveal manual-bullet">
          <span className="manual-bullet-mark" aria-hidden />
          <p>{b}</p>
        </Reveal>
      ))}
    </div>
  );
}

export default function ManualDoCliente({
  onClose,
  onOpenBriefing,
  onFinish,
  clientName,
}: {
  onClose: () => void;
  onOpenBriefing: () => void;
  // Persists Manual do Cliente completion server-side (client_prefs.manual_seen)
  // so Jornada/Home/Onboarding all reflect it — see PortalPaged's onManualFinish.
  onFinish: () => void;
  clientName: string;
}) {
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const total = MANUAL_SLIDES.length;
  const slide = MANUAL_SLIDES[index];

  const go = useCallback(
    (next: number) => {
      if (next < 0 || next >= total) return;
      setDir(next > index ? 1 : -1);
      setIndex(next);
    },
    [index, total],
  );

  useEffect(() => {
    if (index === total - 1) onFinish();
  }, [index, total, onFinish]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(index + 1);
      else if (e.key === "ArrowLeft") go(index - 1);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [go, index, onClose]);

  // Same body-scroll lock as the compass Overlay — position:fixed with the
  // scroll offset frozen, restored on close.
  useEffect(() => {
    const scrollY = window.scrollY;
    const body = document.body;
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    return () => {
      body.style.position = "";
      body.style.top = "";
      body.style.left = "";
      body.style.right = "";
      window.scrollTo(0, scrollY);
    };
  }, []);

  const handleBriefing = useCallback(() => {
    onClose();
    onOpenBriefing();
  }, [onClose, onOpenBriefing]);

  const handleFinishClick = useCallback(() => {
    onFinish();
    onClose();
  }, [onFinish, onClose]);

  return (
    <div className="manual-viewer" data-manual-theme={slide.theme} role="dialog" aria-modal="true" aria-label="Manual do Cliente">
      <div className="manual-top">
        <span className="manual-eyebrow">Manual do Cliente · {String(index + 1).padStart(2, "0")}</span>
        <button className="manual-close" onClick={onClose} aria-label="Fechar">Fechar ✕</button>
      </div>

      <div className="manual-stage">
        <div key={index} className={`manual-slide manual-in-${dir === 1 ? "next" : "prev"}`}>
          <SlideBody slide={slide} onBriefing={handleBriefing} onFinish={handleFinishClick} clientName={clientName} />
        </div>
      </div>

      <div className="manual-controls">
        <span className="manual-count">{String(index + 1).padStart(2, "0")} / {total}</span>
        <div className="manual-controls-right">
          <button className="manual-btn" disabled={index === 0} onClick={() => go(index - 1)}>← Anterior</button>
          <button className="manual-btn" onClick={onClose}>Menu</button>
          <button className="manual-btn primary" disabled={index === total - 1} onClick={() => go(index + 1)}>Próximo →</button>
        </div>
      </div>
    </div>
  );
}
