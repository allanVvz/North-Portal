"use client";

import ParentCardsBoard from "../operacao/ParentCardsBoard";
import type { ActionPlan } from "@/lib/supabase";

// A tela do Plano de Ação é o MESMO acordeão das Entregas — plano e entrega
// viraram a mesma arquitetura (mesmo tipo de card, mesmos elos, mesmo rollup),
// e a única diferença são os textos. As duas abas continuam separadas na
// navegação; o componente é um só. O que se cria aqui é decidido no modal
// (escolher "Plano de Ação" no dropdown de tipo).
export default function ActionPlansBoard({ initial }: { initial: ActionPlan[] }) {
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
        sortScope="plano.lista"
        showStepCount={false}
        texts={{
          newLabel: "+ Nova tarefa",
          empty: "Nenhum plano de ação ainda. Crie uma tarefa do tipo Plano de Ação.",
          emptyQuery: "Nenhum plano para essa busca.",
          searchPlaceholder: "Todos os clientes · buscar por cliente, responsável, prazo…",
          descriptionHint: "Adicione à descrição o porquê e o resultado esperado deste plano.",
        }}
      />
    </div>
  );
}
