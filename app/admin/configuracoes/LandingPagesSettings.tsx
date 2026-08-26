import { LANDING_PAGES } from "@/lib/landingPages";

export default function LandingPagesSettings() {
  return (
    <div className="set-card">
      <h2 className="set-h">Landing Pages</h2>
      <p className="admin-sub">Páginas públicas de captação usadas em campanhas e divulgação.</p>
      <div className="set-legal">
        {LANDING_PAGES.map((lp) => (
          <div className="set-legal-row" key={lp.slug}>
            <span className="set-legal-ico">↗</span>
            <div className="set-legal-meta">
              <strong>{lp.title}</strong>
              <span className="admin-sub">{lp.description}</span>
              <span className="admin-sub">{lp.path}</span>
            </div>
            <a className="admin-btn ghost" href={lp.path} target="_blank" rel="noopener noreferrer">
              Visualizar ↗
            </a>
          </div>
        ))}
        {LANDING_PAGES.length === 0 ? <p className="admin-sub">Nenhuma landing page cadastrada.</p> : null}
      </div>
    </div>
  );
}
