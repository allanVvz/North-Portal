import { redirect } from "next/navigation";

// /admin passou a ser só a porta de entrada: a Home é o destino, a lista de
// clientes tem rota própria em /admin/clientes. Mantido como redirect para não
// quebrar links antigos (e o bookmark de quem já usava /admin).
export default function AdminRootPage() {
  redirect("/admin/home");
}
