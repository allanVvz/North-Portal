"use client";

import ClientsTable, { type ClientRow } from "../ClientsTable";
import LeadsScreen from "./LeadsScreen";
import { useClientesPrefs } from "./leadsPrefs";
import type { LeadRecord } from "@/lib/supabase";

// Duas telas na mesma rota, com a seleção na linha superior — mesmo formato de
// /admin/operacao (Tarefas/Rotinas/Plano) e de /admin/documentos. O projeto
// nunca transformou "ângulos da mesma seção" em rota nova, então nada muda em
// NAV_ITEMS e o menu lateral segue destacando Clientes.
//
// Sem estado compartilhado entre as duas: elas não dividem filtro nem dados, e
// os dois conjuntos já vêm prontos do server component. O padrão pesado de
// usePerformanceWorkspace só se paga quando as telas precisam do mesmo fetch.
export default function ClientesWorkspace({
  clients,
  leads,
}: {
  clients: ClientRow[];
  leads: LeadRecord[];
}) {
  const { section, view, setSection, setView } = useClientesPrefs();
  const novos = leads.filter((lead) => lead.status === "novo").length;

  return (
    <>
      <nav className="clients-section-tabs" aria-label="Seções de clientes">
        <button type="button" className={section === "clientes" ? "on" : ""} onClick={() => setSection("clientes")}>
          Clientes <span>{clients.filter((c) => !c.disabled).length}</span>
        </button>
        <button type="button" className={section === "leads" ? "on" : ""} onClick={() => setSection("leads")}>
          Leads {novos > 0 ? <span>{novos}</span> : null}
        </button>
      </nav>

      {section === "clientes" ? (
        clients.length
          ? <ClientsTable clients={clients} />
          : <p className="admin-empty">Nenhum cliente ainda. Crie o primeiro.</p>
      ) : (
        <>
          <div className="kb-viewtabs leads-viewtabs" role="group" aria-label="Visualização dos leads">
            <button type="button" className={view === "kanban" ? "on" : ""} onClick={() => setView("kanban")}>Kanban</button>
            <button type="button" className={view === "tabela" ? "on" : ""} onClick={() => setView("tabela")}>Tabela</button>
          </div>
          <LeadsScreen leads={leads} view={view} />
        </>
      )}
    </>
  );
}
