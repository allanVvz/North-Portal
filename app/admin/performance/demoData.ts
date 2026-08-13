import type { MetaPost, MetaPostType } from "@/lib/windsor";

// Deterministic sample data for the Performance dashboard's demo mode (no
// Windsor key configured yet). Seeded PRNG (mulberry32) so every render and
// every reload shows the exact same posts — charts don't jump around, and
// tests can assert on the output.

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEMO_ACCOUNTS = [
  { accountId: "demo_ig_1", accountName: "Demo · Instagram", platform: "instagram" as const },
  { accountId: "demo_fb_1", accountName: "Demo · Facebook", platform: "facebook" as const },
];

const CAPTIONS = [
  "Bastidores da produção desta semana 🎬",
  "Novidade chegando na loja — fiquem ligados!",
  "Antes e depois que fala, né?",
  "Promoção relâmpago só hoje ⚡",
  "Cliente feliz é o que move a gente 💚",
  "Reels novo no ar — corre lá",
  "Dica rápida pra quem está começando",
  "Aquele resultado que dá orgulho de mostrar",
  "Time reunido pra mais uma entrega",
  "Lançamento oficial! Conta pra gente o que achou",
  "Por dentro do processo: do briefing ao post",
  "Sexta-feira pede um conteúdo especial",
];

const TYPES: MetaPostType[] = ["reel", "carrossel", "imagem", "video", "story"];

const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** ~45 organic posts + a paid campaign series across the last 90 days. */
export function generateDemoPosts(today = new Date()): MetaPost[] {
  const rand = mulberry32(20260712);
  const posts: MetaPost[] = [];

  for (let i = 0; i < 45; i++) {
    const daysAgo = Math.floor(rand() * 90);
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysAgo);
    const account = DEMO_ACCOUNTS[rand() < 0.65 ? 0 : 1];
    const type = TYPES[Math.floor(rand() * TYPES.length)];
    // Reels reach further; keep metrics loosely correlated so charts look real.
    const base = 800 + rand() * 7000 * (type === "reel" ? 1.8 : 1);
    const alcance = Math.round(base);
    const impressoes = Math.round(base * (1.1 + rand() * 0.5));
    const likes = Math.round(alcance * (0.03 + rand() * 0.05));
    const comentarios = Math.round(likes * (0.05 + rand() * 0.15));
    const compartilhamentos = Math.round(likes * (0.03 + rand() * 0.12));
    const salvos = Math.round(likes * (0.05 + rand() * 0.2));
    posts.push({
      id: `demo_post_${i}`,
      date: isoDay(d),
      accountId: account.accountId,
      accountName: account.accountName,
      platform: account.platform,
      source: "organic",
      type,
      caption: CAPTIONS[i % CAPTIONS.length],
      permalink: null,
      metrics: {
        alcance,
        impressoes,
        likes,
        comentarios,
        compartilhamentos,
        salvos,
        engajamento: likes + comentarios + compartilhamentos + salvos,
        ...(type === "reel" || type === "video" ? { videoViews: Math.round(alcance * (0.6 + rand() * 0.5)) } : {}),
      },
    });
  }

  // Paid: one campaign reporting every ~3 days.
  for (let i = 0; i < 30; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i * 3);
    const impressoes = Math.round(3000 + rand() * 9000);
    const cliques = Math.round(impressoes * (0.01 + rand() * 0.03));
    const custo = Math.round((20 + rand() * 120) * 100) / 100;
    posts.push({
      id: `demo_paid_${i}`,
      date: isoDay(d),
      accountId: "demo_fb_ads",
      accountName: "Demo · Facebook Ads",
      platform: "facebook",
      source: "paid",
      type: "outro",
      caption: "Campanha Demo — Tráfego Loja",
      permalink: null,
      metrics: {
        impressoes,
        cliques,
        custo,
        ctr: Math.round((cliques / impressoes) * 10000) / 100,
        cpc: cliques > 0 ? Math.round((custo / cliques) * 100) / 100 : 0,
        conversoes: Math.round(cliques * (0.05 + rand() * 0.15)),
      },
    });
  }

  return posts;
}
