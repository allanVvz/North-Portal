"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { InsightCandidate, InsightScreen } from "./insightCandidates";

// Os três insights da tela, logo abaixo do cabeçalho (30/09/2026). Aparecem na
// hora com o texto das regras e trocam pelo texto da IA quando ele chega — a
// tela nunca espera a IA para dizer o que fazer. Cada insight é um link para
// o recorte exato do fato.

type Insight = InsightCandidate & { source?: "ia" | "regras" };

export default function InsightsRail({ screen, candidates, loading }: {
  screen: InsightScreen;
  /** null enquanto os dados da tela carregam. */
  candidates: InsightCandidate[] | null;
  loading?: boolean;
}) {
  // A chave muda só quando os FATOS mudam; re-renderizar a tela não repete a chamada.
  const key = useMemo(() => (candidates ? JSON.stringify(candidates.map(({ id, title }) => [id, title])) : ""), [candidates]);
  const [answer, setAnswer] = useState<{ key: string; insights: Insight[] } | null>(null);

  useEffect(() => {
    if (!candidates?.length) return;
    let active = true;
    fetch("/api/admin/insights/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ screen, candidates: candidates.slice(0, 14) }),
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { insights?: Insight[] } | null) => { if (active && data?.insights?.length) setAnswer({ key, insights: data.insights }); })
      .catch(() => {});
    return () => { active = false; };
    // `candidates` entra pela chave: mesma lista de fatos, mesma chamada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, screen]);

  if (loading || !candidates) return <div className="insights-rail is-loading" aria-hidden><span /><span /><span /></div>;
  if (!candidates.length) return null;
  const shown: Insight[] = answer?.key === key ? answer.insights : candidates.slice(0, 3);

  return (
    <section className="insights-rail" aria-label="Insights">
      {shown.map((insight) => (
        <Link key={insight.id} href={insight.href} className={`insight tone-${insight.tone}`}>
          <span className="insight-title"><span className={`op-dot tone-${insight.tone === "info" ? "ok" : insight.tone}`} aria-hidden />{insight.title}</span>
          <span className="insight-detail">{insight.detail}</span>
          <span className="insight-go">{insight.action} →{insight.source === "ia" ? <em title="Escolhido e redigido pela IA a partir dos números da tela">IA</em> : null}</span>
        </Link>
      ))}
    </section>
  );
}
