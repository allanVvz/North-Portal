import { notFound } from "next/navigation";
import Link from "next/link";
import { getAdminClientDetail, getClient, listActionPlans, listTasks } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import { taskProgress } from "@/lib/taskCatalog";
import InstagramPanel from "./InstagramPanel";
import ClientOverview from "./ClientOverview";

export const dynamic = "force-dynamic";

// "Ver cliente" — the read-only dashboard an admin opens to understand a client
// at a glance. Editing lives one click away in /admin/[slug].
export default async function ClientVisaoPage({ params }: { params: Promise<{ slug: string }> }) {
  await requireAdmin();
  const { slug } = await params;
  const [detail, client] = await Promise.all([getAdminClientDetail(slug), getClient(slug, true)]);
  if (!detail || !client) notFound();

  const [tasks, allPlans] = await Promise.all([listTasks(client.id), listActionPlans()]);
  const checkpoints = tasks
    .filter((t) => t.kind === "checkpoint_comercial")
    .map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      done: t.status === "aprovado",
      dueDate: t.due_date,
    }));
  const plans = allPlans
    .filter((p) => p.clientSlug === slug)
    .map((p) => ({ id: p.id, title: p.title, progress: p.progress, activities: p.activities.length, status: p.status }));
  const openTasks = tasks
    .filter((t) => t.kind !== "checkpoint_comercial" && t.status !== "aprovado")
    .slice(0, 6)
    .map((t) => ({ id: t.id, title: t.title, status: t.status, kind: t.kind, progress: taskProgress(t) }));

  return (
    <section className="admin-page">
      <header className="admin-head">
        <div>
          <p className="admin-crumb">
            <Link href="/admin/clientes" className="admin-btn ghost" style={{ padding: 0 }}>
              Clientes
            </Link>{" "}
            › {detail.name}
          </p>
          <h1 className="serif admin-title">{detail.name}</h1>
        </div>
        <div className="admin-head-actions">
          <Link href={`/${detail.slug}`} target="_blank" className="admin-btn ghost">
            Portal ↗
          </Link>
          <Link href={`/admin/${detail.slug}`} className="admin-btn primary">
            Editar cliente
          </Link>
        </div>
      </header>

      <ClientOverview
        detail={detail}
        checkpoints={checkpoints}
        plans={plans}
        openTasks={openTasks}
        instagram={<InstagramPanel slug={detail.slug} handle={detail.companyInfo.instagramOuSite ?? null} clientName={detail.name} />}
      />
    </section>
  );
}
