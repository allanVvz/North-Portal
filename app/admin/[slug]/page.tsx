import { notFound } from "next/navigation";
import Link from "next/link";
import { getAdminClientDetail } from "@/lib/supabase";
import ClientEditor from "../ClientEditor";

export const dynamic = "force-dynamic";

export default async function EditClientPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const detail = await getAdminClientDetail(slug);
  if (!detail) notFound();

  return (
    <section className="admin-page admin-narrow">
      <header className="admin-head">
        <div>
          <p className="admin-eyebrow">Editar cliente · <code className="admin-slug">/{detail.slug}</code></p>
          <h1 className="serif admin-title">{detail.name}</h1>
        </div>
        <div className="admin-head-actions">
          <Link href={`/${detail.slug}`} target="_blank" className="admin-btn ghost">
            Portal ↗
          </Link>
          <Link href="/admin" className="admin-btn ghost">
            ← Voltar
          </Link>
        </div>
      </header>

      <ClientEditor slug={detail.slug} detail={detail} />
    </section>
  );
}
