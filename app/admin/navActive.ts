// Qual item da sidebar está ativo — pura função da ROTA, nunca de estado do
// modal ou de dados da tarefa aberta (um card pode pertencer a um cliente
// diferente da tela em que foi aberto; isso não pode acender "Clientes").
//
// `/admin/kanban` é o quadro de tarefas por fora das abas de Operação — a
// mesma tela (KanbanBoard.tsx), só que como URL própria para link direto
// ("Copiar link", NorthAi). Sem o alias abaixo, `isNavItemActive` não
// reconhecia a rota: ela caía no fallback pensado para `/admin/<slug>` de
// Clientes e acendia o item errado.
export const ROUTE_ALIASES: Record<string, string> = {
  "/admin/kanban": "/admin/operacao",
};

export function resolveActivePathname(pathname: string): string {
  return ROUTE_ALIASES[pathname] ?? pathname;
}

/**
 * Mesma regra de sempre (rota bate com o href, ou é filha dele), mas sobre o
 * pathname já resolvido pelo alias. `/admin/clientes` continua sendo o
 * fallback das telas que penduram de um cliente (`/admin/novo`,
 * `/admin/<slug>`, `/admin/<slug>/visao`) e que não têm entrada própria no
 * menu — `sectionHrefs` é a lista de rotas "reais" que não devem cair nesse
 * fallback.
 */
export function isNavItemActive(pathname: string, href: string, sectionHrefs: readonly string[]): boolean {
  const effective = resolveActivePathname(pathname);
  if (effective === href || effective.startsWith(`${href}/`)) return true;
  if (href === "/admin/clientes") {
    if (sectionHrefs.some((section) => effective === section || effective.startsWith(`${section}/`))) return false;
    return effective.startsWith("/admin/");
  }
  return false;
}
