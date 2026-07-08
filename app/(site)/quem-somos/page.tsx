export const metadata = { title: "Quem somos · North" };

const VALUES = [
  { ico: "◔", t: "Clareza", d: "Você sempre sabe o que está acontecendo e por quê." },
  { ico: "◆", t: "Execução", d: "Produção cuidadosa, no prazo, com aprovação simples." },
  { ico: "↗", t: "Resultado", d: "Decisões guiadas por dados, não por achismo." },
];

const TEAM = [
  { name: "Ana Vidal", role: "Pessoas & Cultura", d: "Cuida do time, dos clientes e da relação humana em cada operação.", grad: "linear-gradient(135deg,#2f6f64,#12403a)" },
  { name: "Caio Moreira", role: "Roteiros & Tráfego", d: "Estratégia de conteúdo, roteiros e mídia paga que convertem.", grad: "linear-gradient(135deg,#b79552,#7d5f2c)" },
  { name: "Lia Prado", role: "Produção & Execução", d: "Transforma o plano em entrega: cronograma, edição e publicação.", grad: "linear-gradient(135deg,#33607f,#1d3a4f)" },
];

const NUMBERS = [
  { num: "+238 mil", label: "Novos seguidores" },
  { num: "+73%", label: "Faturamento melhorado" },
  { num: "24,6 mi", label: "Views acumuladas" },
  { num: "+1.200", label: "Roteiros & vídeos" },
];

export default function QuemSomosPage() {
  return (
    <>
      <section className="site-wrap">
        <div className="qs-hero">
          <div>
            <p className="site-kicker" style={{ textAlign: "left" }}>A North</p>
            <h1>Marketing com <em>direção</em></h1>
            <p>
              Somos uma agência de marketing e tráfego que trata cada cliente como um destino no mapa.
              Planejamos a rota, produzimos com cuidado e medimos cada passo — sem ruído, sem complexidade desnecessária.
            </p>
            <div className="qs-stats">
              <div><b>+40</b><small>clientes ativos</small></div>
              <div><b>6</b><small>frentes de serviço</small></div>
              <div><b>100%</b><small>foco em resultado</small></div>
            </div>
          </div>
          <aside className="qs-glass">
            <span className="qs-glass-dot" aria-hidden />
            <blockquote>“A agulha segue você.”</blockquote>
            <span>Nosso princípio de navegação.</span>
          </aside>
        </div>

        <div className="qs-vals">
          {VALUES.map((v) => (
            <div className="qs-val" key={v.t}>
              <span className="qs-val-ico">{v.ico}</span>
              <h3>{v.t}</h3>
              <p>{v.d}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="cream-band" style={{ marginTop: "clamp(40px,6vw,72px)" }}>
        <div className="site-wrap">
          <p>“Cada cliente é um destino. A gente traça a rota.”</p>
          <small>North · desde 2024</small>
        </div>
      </div>

      <section className="site-section">
        <div className="site-wrap">
          <div className="qs-compass" aria-hidden>
            <svg width="54" height="54" viewBox="0 0 54 54">
              <circle cx="27" cy="27" r="24" fill="none" stroke="var(--s-border-strong)" />
              <circle cx="27" cy="27" r="15" fill="none" stroke="var(--s-border)" />
              <polygon points="27,8 31,27 27,27" fill="#c6ac74" />
              <polygon points="27,46 23,27 27,27" fill="var(--s-teal)" />
              <circle cx="27" cy="27" r="2.5" fill="var(--s-ink)" />
            </svg>
          </div>
          <p className="site-kicker">Quem conduz a bússola</p>
          <h2 className="site-h2">As pessoas por trás da <em>operação</em></h2>
          <p className="site-lead">Três frentes que trabalham juntas: pessoas, roteiros &amp; tráfego, produção &amp; execução.</p>
          <div className="team-grid">
            {TEAM.map((m) => (
              <article className="team-card" key={m.name}>
                <div className="team-photo" style={{ background: m.grad }}>foto</div>
                <div className="team-body">
                  <b>{m.name}</b>
                  <div><span className="team-role">{m.role}</span></div>
                  <p>{m.d}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="site-section" style={{ background: "var(--s-band)" }}>
        <div className="site-wrap">
          <p className="site-kicker">Nossos números</p>
          <div className="stats-grid">
            {NUMBERS.map((n) => (
              <div className="stat-card" key={n.label}>
                <div className="stat-num">{n.num}</div>
                <div className="stat-label">{n.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
