"use client";

import type { ContextSourceChip } from "@/lib/northai/drafts";

// "Usando: Cadastro do cliente · Etapas de entrega" — só o que o pedido leu de
// verdade. Com o harness de IA, o mesmo lugar mostra o que foi consultado.
export default function ContextSourceChips({ sources }: { sources: readonly ContextSourceChip[] }) {
  if (!sources.length) return null;
  return (
    <p className="nai-sources" aria-label="Fontes usadas">
      <span>Usando</span>
      {sources.map((source) => <b key={source.key}>{source.label}</b>)}
    </p>
  );
}
