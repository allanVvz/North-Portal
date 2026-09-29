import Link from "next/link";
import type { ReactNode } from "react";

// O cabeçalho de toda tela (30/09/2026). Uma linha de contexto (onde estou),
// o título, uma frase que diz o estado da tela e, à direita, no máximo três
// números — cada um um link para o recorte que o explica — e as ações.
//
// Menos números de propósito: cada tela mostra só o que é dela, no período
// dela (a Home olha 7 dias, Clientes o mês, Performance a semana de mídia).
// O que antes era uma faixa de KPIs repetida em várias telas virou insight
// (InsightsRail), que diz o que fazer em vez de só medir.

export type HeaderKpi = {
  label: string;
  value: string | number;
  /** Uma palavra de contexto sob o número ("de 12", "↑ 8%"). */
  hint?: string;
  href?: string;
  tone?: "late" | "warn" | "ok";
};

export default function ScreenHeader({ title, lede, crumbs, period, kpis, actions }: {
  title: ReactNode;
  lede?: ReactNode;
  crumbs?: { label: string; href?: string }[];
  /** O período que os números cobrem ("últimos 7 dias", "setembro"). */
  period?: string;
  kpis?: HeaderKpi[];
  actions?: ReactNode;
}) {
  return (
    <header className="screen-head">
      <div className="screen-head-main">
        {crumbs?.length ? (
          <nav className="screen-crumbs" aria-label="Você está em">
            {crumbs.map((crumb, index) => (
              <span key={`${crumb.label}-${index}`}>
                {index ? <i aria-hidden>/</i> : null}
                {crumb.href ? <Link href={crumb.href}>{crumb.label}</Link> : crumb.label}
              </span>
            ))}
          </nav>
        ) : null}
        <h1 className="screen-title">{title}</h1>
        {lede ? <p className="screen-lede">{lede}</p> : null}
      </div>
      {kpis?.length || actions ? (
        <div className="screen-head-side">
          {kpis?.length ? (
            <dl className="screen-kpis" aria-label={period ? `Números · ${period}` : "Números"}>
              {period ? <dt className="screen-kpis-period">{period}</dt> : null}
              {kpis.slice(0, 3).map((kpi) => {
                const body = <><dd className={kpi.tone ? `is-${kpi.tone}` : ""}>{kpi.value}{kpi.hint ? <small>{kpi.hint}</small> : null}</dd><dt>{kpi.label}</dt></>;
                return kpi.href
                  ? <Link key={kpi.label} href={kpi.href} className="screen-kpi">{body}</Link>
                  : <div key={kpi.label} className="screen-kpi">{body}</div>;
              })}
            </dl>
          ) : null}
          {actions ? <div className="screen-actions">{actions}</div> : null}
        </div>
      ) : null}
    </header>
  );
}
