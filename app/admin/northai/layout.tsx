import { redirect } from "next/navigation";
import { getSession } from "@/lib/supabase/auth";
import NorthAiTabs from "./NorthAiTabs";

export const dynamic = "force-dynamic";

// NorthAi — duas telas em abas: o Estúdio (harness determinístico que cria
// tarefas, planos, rotinas, fluxos e automações) e as Automações já cadastradas.
export default async function NorthAiLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session || session.role !== "admin") redirect("/login");
  return (
    <section className="admin-page kb-wide nai-page">
      <header className="admin-head">
        <div>
          <h1 className="admin-title">NorthAi</h1>
          <p className="admin-sub">Crie a operação em poucos cliques e veja o que falta amarrar.</p>
        </div>
      </header>
      <NorthAiTabs />
      {children}
    </section>
  );
}
