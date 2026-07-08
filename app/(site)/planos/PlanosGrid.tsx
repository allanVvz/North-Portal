"use client";

import { useState } from "react";
import Link from "next/link";

const PLANS = [
  {
    name: "Start", price: "R$ 1.800", per: "/mês", blurb: "Para começar com consistência.",
    feats: ["Gestão de social media", "Criativos essenciais", "1 campanha por mês", "Relatório mensal", "Suporte por WhatsApp"],
    cta: "Começar", href: "/login", feat: false,
  },
  {
    name: "Growth", price: "R$ 3.200", per: "/mês", blurb: "O plano mais escolhido pelos clientes.",
    feats: ["Tudo do Start, e mais:", "Tráfego pago + delivery", "Onboarding guiado", "Dashboard de performance", "Reunião quinzenal", "Pastas no Drive"],
    cta: "Começar agora", href: "/login", feat: true, badge: "Mais escolhido",
  },
  {
    name: "Custom", price: "Sob consulta", per: "", blurb: "Para operações sob medida.",
    feats: ["Escopo personalizado", "Múltiplas frentes", "Gestor de conta dedicado", "SLA e integrações", "Prioridade de produção"],
    cta: "Falar com a North", href: "mailto:contato@north.test", feat: false,
  },
];

export default function PlanosGrid() {
  const [held, setHeld] = useState<string | null>(null);

  return (
    <>
      <div className="plans-grid">
        {PLANS.map((p) => (
          <article
            className={`plan ${p.feat ? "feat" : ""} ${held === p.name ? "held" : ""}`}
            key={p.name}
            onPointerDown={() => setHeld(p.name)}
            onPointerUp={() => setHeld(null)}
            onPointerLeave={() => setHeld(null)}
            onPointerCancel={() => setHeld(null)}
          >
            {p.badge ? <span className="plan-badge">{p.badge}</span> : null}
            <span className="plan-name">{p.name}</span>
            <div className="plan-price">{p.price}{p.per ? <small> {p.per}</small> : null}</div>
            <p className="plan-blurb">{p.blurb}</p>
            <ul className="plan-feats">
              {p.feats.map((f) => <li key={f}>{f}</li>)}
            </ul>
            <Link href={p.href} className={`site-btn ${p.feat ? "solid" : "ghost"}`}>{p.cta}</Link>
          </article>
        ))}
      </div>
      <p className="site-lead" style={{ marginTop: 34, fontSize: 13 }}>
        Todos os planos incluem acesso ao portal North com briefing, aprovações e dashboard.
      </p>
      <p className="plans-hint">Pressione e segure um plano para ampliar os detalhes (hold).</p>
    </>
  );
}
