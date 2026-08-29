"use client";

import ParentCardsBoard from "../operacao/ParentCardsBoard";
import type { ActionPlan } from "@/lib/supabase";

// A tela do Plano de Ação é o MESMO acordeão das Entregas — plano e entrega
// viraram a mesma arquitetura (mesmo tipo de card, mesmos elos, mesmo rollup),
// e a única diferença é o comportamento do tipo e os textos. As duas abas
// continuam separadas na navegação; o componente é um só.
export default function ActionPlansBoard({
  initial,
  clients,
  assignees,
}: {
  initial: ActionPlan[];
  clients: { slug: string; name: string }[];
  assignees: string[];
}) {
  return (
    <div className="ap">
      <header className="admin-head">
        <div>
          <p className="admin-kicker">Operação</p>
          <h1 className="admin-title">Plano de Ação</h1>
        </div>
      </header>
      <ParentCardsBoard
        initial={initial}
        clients={clients}
        assignees={assignees}
        scope="plan"
        initialKind="plano_acao"
        sortScope="plano.lista"
        showStepCount={false}
        texts={{
          newLabel: "+ Plano",
          empty: "Nenhum plano de ação ainda. Crie uma tarefa do tipo Plano de Ação.",
          emptyQuery: "Nenhum plano para essa busca.",
          searchPlaceholder: "Todos os clientes · buscar por cliente, responsável, prazo…",
          descriptionHint: "Adicione à descrição o porquê e o resultado esperado deste plano.",
        }}
      />
    </div>
  );
}
