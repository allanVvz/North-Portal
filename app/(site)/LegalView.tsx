import Link from "next/link";
import { listLegalDocs } from "@/lib/supabase";

const TABS = [
  { slug: "privacidade", href: "/politica-de-privacidade", label: "Privacidade" },
  { slug: "termos", href: "/termos-de-uso", label: "Termos de Uso" },
  { slug: "cookies", href: "/politica-de-cookies", label: "Cookies" },
];

function fmt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${d.getDate()} ${MES[d.getMonth()]} ${d.getFullYear()}`;
}

// Reads the legal_docs table (RLS: readable by everyone) so the admin's
// Configurações › Políticas edits show up here on the public site.
export default async function LegalView({ slug }: { slug: string }) {
  const docs = await listLegalDocs().catch(() => []);
  const doc = docs.find((d) => d.slug === slug);

  return (
    <section className="legal">
      <div className="legal-tabs">
        {TABS.map((t) => (
          <Link key={t.slug} href={t.href} className={`site-btn ghost ${t.slug === slug ? "active" : ""}`}>
            {t.label}
          </Link>
        ))}
      </div>
      <p className="legal-kicker">{(doc?.title ?? "Documento").toUpperCase()} · ATUALIZADA EM {fmt(doc?.updated_at ?? null).toUpperCase()}</p>
      <h1>{doc?.title ?? "Documento"}</h1>
      {doc?.status !== "publicada" ? <p className="legal-meta">Rascunho — visível apenas para pré-visualização.</p> : null}
      <div className="legal-body">{doc?.body || "Conteúdo em breve."}</div>
    </section>
  );
}
