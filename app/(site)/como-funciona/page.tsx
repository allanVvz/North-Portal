export const metadata = { title: "Como funciona · North" };

const STEPS = [
  { n: "01", t: "Imersão & Onboarding", d: "Briefing por etapas e organização de acessos e pastas. Quanto mais contexto, mais certeira a estratégia." },
  { n: "02", t: "Estratégia & Alinhamento", d: "Planejamento, roteiros e aprovação prévia antes de qualquer produção." },
  { n: "03", t: "Produção & Aprovação", d: "Criativos e campanhas entregues no portal para sua aprovação com um clique." },
  { n: "04", t: "Publicação & Resultados", d: "Publicamos o aprovado e medimos tudo no dashboard de performance." },
];

export default function ComoFuncionaPage() {
  return (
    <>
      <section className="site-section">
        <div className="site-wrap">
          <p className="site-kicker">Como funciona</p>
          <h2 className="site-h2">Do briefing ao <em>resultado</em></h2>
          <p className="site-lead">Um processo claro, em quatro movimentos — você sempre sabe onde está.</p>
          <div className="steps-grid">
            {STEPS.map((s) => (
              <div className="step" key={s.n}>
                <div className="step-num">{s.n}</div>
                <h3>{s.t}</h3>
                <p>{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      <div className="cream-band">
        <div className="site-wrap">
          <p>“Clareza primeiro. Resultado como consequência.”</p>
          <small>Filosofia North</small>
        </div>
      </div>
    </>
  );
}
