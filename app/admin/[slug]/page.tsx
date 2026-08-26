import { notFound } from "next/navigation";
import Link from "next/link";
import { getAdminClientDetail, getMetaSettings, getWindsorSettings, listAdAccountOptions, listScopeTags } from "@/lib/supabase";
import { isGoogleDriveConfigured } from "@/lib/googleDriveApi";
import ClientEditor from "../ClientEditor";

export const dynamic = "force-dynamic";

export default async function EditClientPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [detail, scopeTags, adAccounts, meta, windsor] = await Promise.all([
    getAdminClientDetail(slug),
    listScopeTags(),
    listAdAccountOptions(),
    getMetaSettings(),
    getWindsorSettings(),
  ]);
  if (!detail) notFound();

  // The ad-account mapping lives in the integrations vault keyed by slug, not
  // on the client row — read whichever provider currently owns this client.
  const linked = meta.accountMap[detail.slug] ?? windsor.accountMap[detail.slug] ?? null;

  return (
    <section className="admin-page admin-narrow">
      <header className="admin-head">
        <div>
          <p className="admin-eyebrow">Editar cliente · <code className="admin-slug">/{detail.slug}</code></p>
          <h1 className="serif admin-title">{detail.name}</h1>
        </div>
        <div className="admin-head-actions">
          <Link href={`/admin/${detail.slug}/visao`} className="admin-btn ghost">
            Ver cliente
          </Link>
          <Link href={`/${detail.slug}`} target="_blank" className="admin-btn ghost">
            Portal ↗
          </Link>
          <Link href="/admin/clientes" className="admin-btn ghost">
            ← Voltar
          </Link>
        </div>
      </header>

      <ClientEditor
        slug={detail.slug}
        detail={detail}
        scopeTags={scopeTags}
        adAccounts={adAccounts}
        adAccountId={linked?.accountId ?? ""}
        driveConfigured={isGoogleDriveConfigured()}
      />
    </section>
  );
}
