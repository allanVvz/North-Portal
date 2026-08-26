"use client";

import { useEffect, useState } from "react";
import type { MetaPost } from "@/lib/windsor";

// Contact sheet of the client's real Instagram posts, pulled from the same
// Windsor/Meta feed the Performance dashboards use — Instagram has no official
// profile embed, and inventing one from a screenshot would be a lie. Each cell
// carries its own telemetry, which is the point: this is a working surface, not
// a mirror of the app.

type Props = { slug: string; handle: string | null; clientName: string };

const TYPE_LABEL: Record<string, string> = {
  reel: "Reel",
  video: "Vídeo",
  carrossel: "Carrossel",
  imagem: "Foto",
  story: "Story",
  outro: "Post",
};

function compact(n: number | undefined): string {
  if (n === undefined) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(".", ",")}k`;
  return String(n);
}

function engagementRate(p: MetaPost): string {
  const reach = p.metrics.alcance;
  const eng = p.metrics.engajamento;
  if (!reach || eng === undefined) return "—";
  return `${((eng / reach) * 100).toFixed(1).replace(".", ",")}%`;
}

export default function InstagramPanel({ slug, handle, clientName }: Props) {
  const [posts, setPosts] = useState<MetaPost[] | null>(null);
  const [demo, setDemo] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await fetch(`/api/admin/performance/insights?client=${encodeURIComponent(slug)}`);
      if (!alive) return;
      if (!res.ok) {
        setPosts([]);
        return;
      }
      const data = (await res.json()) as { posts?: MetaPost[]; demo?: boolean };
      if (!alive) return;
      setDemo(Boolean(data.demo));
      const organic = (data.posts ?? [])
        .filter((p) => p.source === "organic" && p.platform === "instagram")
        .sort((a, b) => b.date.localeCompare(a.date));
      setPosts(organic);
    })();
    return () => {
      alive = false;
    };
  }, [slug]);

  const top = posts ? [...posts].sort((a, b) => (b.metrics.alcance ?? 0) - (a.metrics.alcance ?? 0)).slice(0, 3) : [];
  const topIds = new Set(top.map((p) => p.id));

  return (
    <div className="admin-card ig">
      <div className="ig-head">
        <span className="ig-kicker">Instagram</span>
        {demo ? <span className="admin-pill muted">dados de demonstração</span> : null}
      </div>

      <div className="ig-profile">
        <span className="ig-avatar" aria-hidden="true">
          {clientName.slice(0, 2).toUpperCase()}
        </span>
        <div className="ig-id">
          <strong>{handle ? (handle.startsWith("@") ? handle : `@${handle}`) : clientName}</strong>
          <span className="admin-hint">{clientName}</span>
        </div>
        <div className="ig-counts">
          <span>
            <strong>{posts ? posts.length : "—"}</strong>
            <em>publicações</em>
          </span>
          <span>
            <strong>{compact(posts?.reduce((s, p) => s + (p.metrics.alcance ?? 0), 0))}</strong>
            <em>alcance somado</em>
          </span>
        </div>
      </div>

      {posts === null ? (
        <p className="admin-hint">Carregando publicações…</p>
      ) : posts.length === 0 ? (
        <p className="admin-hint">
          Nenhuma publicação encontrada. Vincule uma conta de anúncios em Configurações › Integrações para trazer o
          feed do cliente.
        </p>
      ) : (
        <>
          <div className="ig-subhead">
            <strong>Publicações recentes</strong>
            <span className="admin-hint">{Math.min(posts.length, 9)} de {posts.length}</span>
          </div>
          <div className="ig-grid">
            {posts.slice(0, 9).map((p) => (
              <a
                key={p.id}
                className="ig-cell"
                href={p.permalink ?? undefined}
                target="_blank"
                rel="noreferrer"
                title={p.caption || undefined}
              >
                <span className="ig-media">
                  {p.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.thumbnailUrl} alt="" loading="lazy" />
                  ) : null}
                  <em className="ig-type">{TYPE_LABEL[p.type] ?? "Post"}</em>
                  {topIds.has(p.id) ? <em className="ig-top">★ top</em> : null}
                </span>
                <span className="ig-caption">{p.caption || "Sem legenda"}</span>
                <span className="ig-metrics">
                  <span>
                    <strong>{compact(p.metrics.alcance)}</strong> alcance
                  </span>
                  <span>{engagementRate(p)}</span>
                </span>
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
