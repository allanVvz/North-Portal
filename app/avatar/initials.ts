// Regra única de iniciais.
//
// Antes existiam três regras diferentes espalhadas pelo app, e a mesma pessoa
// aparecia com sigla diferente dependendo da tela: "Allan Ulisses Silva" virava
// "AS" no Kanban e em Quem Somos, mas "AU" na barra lateral e em Configurações.
// A regra que ficou é a de primeiro + último nome, que é a convenção usada para
// pessoas e a que já valia na página pública.
//
// Vale para pessoas E para nomes de cliente (que também caem em círculo de
// iniciais em Clientes/Documentos/Operação) — é a mesma pergunta: "duas letras
// que representem este nome".
export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
