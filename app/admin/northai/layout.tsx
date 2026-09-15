import { redirect } from "next/navigation";
import { getSession } from "@/lib/supabase/auth";
import "./northai.css";

export const dynamic = "force-dynamic";

// NorthAi — Estúdio (tela cheia, conversa) e Automações. Cada tela desenha o
// próprio cabeçalho: no Estúdio ele rola junto da conversa para dar espaço ao
// diálogo; em Automações é o cabeçalho de página de sempre.
export default async function NorthAiLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session || session.role !== "admin") redirect("/login");
  return <>{children}</>;
}
