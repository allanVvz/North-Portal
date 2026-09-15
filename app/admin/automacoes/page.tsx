import { redirect } from "next/navigation";

// Automações virou uma aba do NorthAi (15/09). A rota antiga continua viva só
// para não quebrar favoritos e links em comentários.
export default function AutomacoesRedirect() {
  redirect("/admin/northai/automacoes");
}
