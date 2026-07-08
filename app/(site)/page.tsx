"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const SLIDES = [
  {
    kicker: "Agência de marketing & tráfego",
    title: ["Sua operação com ", "clareza"],
    sub: "Briefing, criativos, aprovações e resultados — guiados como uma bússola.",
    ctas: [
      { label: "Começar agora", href: "/planos", variant: "light" },
      { label: "Ver cases", href: "#cases", variant: "on-dark" },
    ],
  },
  {
    kicker: "Resultados que importam",
    title: ["Marketing que vira ", "referência"],
    sub: "Tráfego, conteúdo e produção medidos de ponta a ponta, sem achismo.",
    ctas: [
      { label: "Ver planos", href: "/planos", variant: "light" },
      { label: "Como funciona", href: "/como-funciona", variant: "on-dark" },
    ],
  },
  {
    kicker: "Um portal, toda a operação",
    title: ["Você sempre sabe ", "onde está"],
    sub: "Do briefing ao dashboard, cada passo da sua conta em um só lugar.",
    ctas: [
      { label: "Começar agora", href: "/planos", variant: "light" },
      { label: "Falar com a North", href: "mailto:contato@north.test", variant: "on-dark" },
    ],
  },
] as const;

const SERVICES = [
  { cat: "Captação & Conteúdo", icon: "📈", items: ["Diária de captação", "Orientação de story", "Atendimento comercial de leads", "Estratégia de conteúdo", "Google Meu Negócio"] },
  { cat: "Produção de Conteúdo", icon: "📱", items: ["Roteiros de conteúdo", "Roteiros de anúncios", "Posts de feed", "Capas (destaque/feed)", "Layouts", "Edição de criativos", "Edição de Reels", "Flyers de eventos"] },
  { cat: "Gestão & Performance", icon: "📊", items: ["Gestão de tráfego", "Gestão de perfil", "Análise de perfil", "Assessoria comercial", "Scripts de vendas"] },
  { cat: "Planejamento & Organização", icon: "📅", items: ["Calendário editorial", "Aprovações no portal", "Pastas no Drive", "Dashboard de resultados"] },
];

const STATS = [
  { num: "+238 mil", label: "Novos seguidores", desc: "conquistados nos últimos 12 meses" },
  { num: "+73%", label: "Faturamento", desc: "melhorado e resolvido para clientes" },
  { num: "24,6 mi", label: "Alcance em views", desc: "acumulados em vídeos e roteiros" },
  { num: "+1.200", label: "Roteiros & vídeos", desc: "entregues com a operação North" },
];

const TESTIMONIALS = [
  { quote: "A operação ficou clara. Cada semana sei exatamente o que está saindo.", name: "Rafael Beltrão", org: "Baita Conveniência", grad: "linear-gradient(135deg,#2f6f64,#12403a)" },
  { quote: "Agenda cheia e criativos afiados. Virou nossa vantagem.", name: "Marina Cabral", org: "Prime Detailing", grad: "linear-gradient(135deg,#b79552,#7d5f2c)" },
  { quote: "Transparência total no briefing e nos resultados. Recomendo.", name: "Diego Nunes", org: "Studio Norte", grad: "linear-gradient(135deg,#33607f,#1d3a4f)" },
];

export default function LandingPage() {
  const [slide, setSlide] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setSlide((s) => (s + 1) % SLIDES.length), 6000);
    return () => window.clearInterval(id);
  }, []);
  const s = SLIDES[slide];
  const move = (dir: 1 | -1) => setSlide((p) => (p + dir + SLIDES.length) % SLIDES.length);

  return (
    <>
      {/* HERO */}
      <section className="site-wrap">
        <div className="hero">
          <div className="hero-card">
            <span className="hero-kicker">{s.kicker}</span>
            <h1 className="hero-title">
              {s.title[0]}<em>{s.title[1]}</em>
            </h1>
            <p className="hero-sub">{s.sub}</p>
            <div className="hero-ctas">
              {s.ctas.map((c) => (
                <Link key={c.label} href={c.href} className={`site-btn ${c.variant}`}>{c.label}</Link>
              ))}
            </div>
            <div className="hero-dots" role="tablist" aria-label="Slides">
              {SLIDES.map((_, i) => (
                <i key={i} className={i === slide ? "on" : ""} onClick={() => setSlide(i)} role="tab" aria-selected={i === slide} />
              ))}
            </div>
            <div className="hero-arrows">
              <button className="hero-arrow" onClick={() => move(-1)} aria-label="Slide anterior">‹</button>
              <button className="hero-arrow" onClick={() => move(1)} aria-label="Próximo slide">›</button>
            </div>
          </div>
        </div>
      </section>

      {/* RESULTADOS */}
      <section className="site-section" style={{ background: "var(--s-band)" }}>
        <div className="site-wrap">
          <p className="site-kicker">Resultados que importam</p>
          <div className="stats-grid">
            {STATS.map((st) => (
              <div className="stat-card" key={st.label}>
                <div className="stat-num">{st.num}</div>
                <div className="stat-label">{st.label}</div>
                <div className="stat-desc">{st.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CASES */}
      <section className="site-section" id="cases">
        <div className="site-wrap">
          <p className="site-kicker">Cases · resultados reais</p>
          <h2 className="site-h2">Operações que viraram <em>referência</em></h2>
          <div className="cases">
            <div className="case-row">
              <div className="case-copy">
                <span className="case-tag">Conveniência · Delivery</span>
                <h3 className="case-name">Baita <em>Conveniência</em></h3>
                <p className="case-desc">Delivery e loja em 3 meses de operação North — pedidos, ticket e alcance em crescimento consistente.</p>
                <div className="case-chips"><span>Tráfego pago</span><span>Social</span><span>Conteúdo</span></div>
              </div>
              <div className="case-mock">
                <p className="mock-title">Resultados · Baita Conveniência</p>
                <div className="mock-kpis">
                  <div className="mock-kpi"><small>Pedidos/mês</small><b>+142%</b></div>
                  <div className="mock-kpi tone-sand"><small>Ticket</small><b>R$ 38</b></div>
                  <div className="mock-kpi tone-deep"><small>ROI</small><b>4,3x</b></div>
                </div>
                <div className="mock-bars">
                  {[34, 38, 36, 42, 46, 44, 52, 58, 56, 64, 70, 76, 80, 88].map((h, i) => (
                    <i key={i} style={{ height: `${h}%`, opacity: [0.25, 0.29, 0.33, 0.37][i % 4] }} />
                  ))}
                </div>
              </div>
            </div>

            <div className="case-row rev">
              <div className="mock-app">
                <div className="mock-side">
                  <b>PRIME</b>
                  <ul>
                    <li>Início</li>
                    <li className="on">Agenda</li>
                    <li>Criativos</li>
                    <li>Resultados</li>
                  </ul>
                </div>
                <div className="mock-cal">
                  <b>Agenda da semana</b>
                  <div className="mock-week">
                    {[
                      { d: "SEG", tones: ["t", "s"] },
                      { d: "TER", tones: ["s", "t", "s"] },
                      { d: "QUA", tones: ["t", "s"] },
                      { d: "QUI", tones: ["s", "t", "s"] },
                      { d: "SEX", tones: ["t", "s"] },
                    ].map((day) => (
                      <div className="mock-day" key={day.d}>
                        <small>{day.d}</small>
                        {day.tones.map((tone, i) => <span key={i} className={tone} />)}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="case-copy">
                <span className="case-tag">Estética automotiva</span>
                <h3 className="case-name">Prime <em>Detailing</em></h3>
                <p className="case-desc">Estética automotiva premium — agenda cheia via tráfego pago e conteúdo que posiciona a marca.</p>
                <div className="case-chips"><span>Tráfego pago</span><span>Social</span><span>Conteúdo</span></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SERVIÇOS (catálogo North) */}
      <section className="site-section" style={{ background: "var(--s-band)" }}>
        <div className="site-wrap">
          <p className="site-kicker">Serviços · personalizável por cliente</p>
          <h2 className="site-h2">Tudo que a sua conta <em>precisa</em></h2>
          <p className="site-lead">Um catálogo montado sob medida — da captação ao calendário editorial.</p>
          <div className="svc-grid">
            {SERVICES.map((g) => (
              <div className="svc-card" key={g.cat}>
                <span className="svc-cat">{g.icon} {g.cat}</span>
                <div className="svc-list">
                  {g.items.map((it) => <span key={it}>{it}</span>)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* DEPOIMENTOS */}
      <section className="site-section">
        <div className="site-wrap">
          <p className="site-kicker">Depoimentos</p>
          <h2 className="site-h2">Quem opera com a <em>North</em></h2>
          <div className="tst-grid">
            {TESTIMONIALS.map((t) => (
              <div className="tst-card" key={t.name}>
                <span className="tst-stars">★★★★★</span>
                <p className="tst-quote">“{t.quote}”</p>
                <div className="tst-who">
                  <span className="tst-av" style={{ background: t.grad }} />
                  <span><b>{t.name}</b><small>{t.org}</small></span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
