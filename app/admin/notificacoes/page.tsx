import { listNotifications, upsertDueSoonNotifications } from "@/lib/notifications";
import { requireAdmin } from "@/lib/supabase/auth";
import NotificationsScreen from "./NotificationsScreen";

export const dynamic = "force-dynamic";

export default async function NotificacoesPage() {
  const session = await requireAdmin();
  // Mesma materialização preguiçosa que a rota GET faz: abrir a tela direto
  // (sem passar pelo sino) não pode mostrar uma caixa desatualizada.
  await upsertDueSoonNotifications(session.userId);
  const notifications = await listNotifications(session.userId, 200);
  return <NotificationsScreen initial={notifications} />;
}
