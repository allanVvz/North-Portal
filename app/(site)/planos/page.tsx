import PlanosGrid from "./PlanosGrid";

export const metadata = { title: "Planos · North" };

export default function PlanosPage() {
  return (
    <section className="site-section">
      <div className="site-wrap">
        <p className="site-kicker">Planos</p>
        <h2 className="site-h2">Escolha seu <em>ritmo</em></h2>
        <p className="site-lead">Comece simples e evolua conforme sua operação cresce. Sem fidelidade engessada.</p>
        <PlanosGrid />
      </div>
    </section>
  );
}
