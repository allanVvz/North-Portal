import { describe, expect, it } from "vitest";
import { blockResolver } from "./campaignBlockKpis";
import { DEFAULT_BUILTIN_TEMPLATE, suggestCampaignBlock } from "@/lib/performanceTemplates";
import type { MetaPost } from "@/lib/windsor";

// Caso real da CRIS CAR CARE, 21/09/2026. A especialista de produto descreveu a
// semana em três blocos — Tráfego para o Site, Tráfego para o Perfil e
// Engajamento/WhatsApp — e o relatório não mostrava isso. Os dados abaixo foram
// lidos da própria Meta (act_2230955893770550, 14–20/09), não inventados:
//
//   [ENGAJAMENTO] Q_NOV $10 cbo   objective=OUTCOME_ENGAGEMENT  adset goal=REPLIES
//   [TRAFEGO] aberto_10/01_$6     objective=LINK_CLICKS         adset goal=PROFILE_VISIT
//   VENDAS | SITE | 03/06 — Cópia objective=OUTCOME_SALES       adset goal=OFFSITE_CONVERSIONS
//
// Este arquivo é a especificação de para onde cada uma vai, e o que se perde
// quando a evidência de nível de anúncio não chega.

const CONFIG = DEFAULT_BUILTIN_TEMPLATE.config;

const post = (over: Partial<MetaPost>): MetaPost => ({
  id: over.id ?? "x", date: "2026-09-20", accountId: "2230955893770550", accountName: "Vítor Pereira FB",
  platform: "instagram", source: "paid", type: "imagem", caption: over.campaignName ?? "", permalink: null,
  metrics: {}, ...over,
});

const ENGAJAMENTO = post({ id: "c1", campaignId: "120238104023730131", campaignName: "[ENGAJAMENTO] Q_NOV $10 cbo", objective: "OUTCOME_ENGAGEMENT" });
const TRAFEGO = post({ id: "c2", campaignId: "120238776103260131", campaignName: "[TRAFEGO] aberto_10/01_$6", objective: "LINK_CLICKS" });
const VENDAS_SITE = post({ id: "c3", campaignId: "120249386591930131", campaignName: "VENDAS | SITE | 03/06 — Cópia", objective: "OUTCOME_SALES" });
const CAMPAIGNS = [ENGAJAMENTO, TRAFEGO, VENDAS_SITE];

/** Anúncios carregam o `optimization_goal` do adset — a evidência mais forte. */
const ADS = [
  post({ id: "a1", adId: "a1", campaignId: "120238104023730131", campaignName: "[ENGAJAMENTO] Q_NOV $10 cbo", optimizationGoal: "REPLIES" }),
  post({ id: "a2", adId: "a2", campaignId: "120238776103260131", campaignName: "[TRAFEGO] aberto_10/01_$6", optimizationGoal: "PROFILE_VISIT" }),
  post({ id: "a3", adId: "a3", campaignId: "120249386591930131", campaignName: "VENDAS | SITE | 03/06 — Cópia", optimizationGoal: "OFFSITE_CONVERSIONS" }),
];

const blocksOf = (ads: MetaPost[]) => {
  const { postBlock } = blockResolver(CONFIG, ads);
  return Object.fromEntries(CAMPAIGNS.map((c) => [c.campaignName, postBlock(c)]));
};

describe("CRIS CAR CARE — blocos de objetivo, dados reais de 14–20/09", () => {
  it("os três blocos da especialista saem separados e com o nome certo", () => {
    expect(blocksOf(ADS)).toEqual({
      // REPLIES = otimizado para conversa. Antes caía em `engajamento` e o card
      // saía "custo por engajamento" em vez de "custo por conversa".
      "[ENGAJAMENTO] Q_NOV $10 cbo": "mensagens",
      "[TRAFEGO] aberto_10/01_$6": "trafego_perfil",
      "VENDAS | SITE | 03/06 — Cópia": "trafego_site",
    });
  });

  it("sem a evidência de nível de anúncio, o bloco Perfil desaparece", () => {
    // No nível de campanha a Meta só diz LINK_CLICKS: é o PROFILE_VISIT do adset
    // que revela a campanha de perfil. Se o fan-out por campanha falhar (e ele é
    // engolido em silêncio, ver reportData.ts), a classificação degrada.
    const semAnuncios = blocksOf([]);
    expect(semAnuncios["[TRAFEGO] aberto_10/01_$6"]).toBe("trafego_site");
    expect(Object.values(semAnuncios)).not.toContain("trafego_perfil");
  });

  it("conversão fora do app conta como tráfego para o site por intenção declarada", () => {
    // Antes o acerto vinha de "OFFSITE_CONVERSIONS" conter a substring "SITE" —
    // troque o nome da campanha e ela caía em `outro`. Agora a regra é explícita.
    const semNome = post({ id: "c3b", campaignId: "zzz", campaignName: "Campanha de vendas", objective: "OUTCOME_SALES" });
    const { postBlock } = blockResolver(CONFIG, []);
    expect(postBlock(semNome)).toBe("trafego_site");
  });
});

describe("suggestCampaignBlock — goals que a operação usa de verdade", () => {
  it("goals de conversa viram bloco de mensagens", () => {
    for (const goal of ["REPLIES", "CONVERSATIONS", "LEAD_GENERATION", "QUALITY_LEAD"]) {
      expect(suggestCampaignBlock(undefined, goal)).toBe("mensagens");
    }
  });

  it("goals de perfil viram bloco de perfil", () => {
    for (const goal of ["PROFILE_VISIT", "PAGE_LIKES", "FOLLOWERS"]) {
      expect(suggestCampaignBlock(undefined, goal)).toBe("trafego_perfil");
    }
  });

  it("OFFSITE_CONVERSIONS não é mais confundido com a palavra SITE", () => {
    // A borda de palavra é o que separa os dois casos: um chega por regra de
    // conversão, o outro pela palavra "site" de verdade.
    expect(suggestCampaignBlock(undefined, "OFFSITE_CONVERSIONS")).toBe("trafego_site");
    expect(suggestCampaignBlock(undefined, undefined, "Landing do site novo")).toBe("trafego_site");
    expect(suggestCampaignBlock(undefined, "OFFSITE_CONVERSIONS", "Perfil - seguidores")).toBe("trafego_perfil");
  });

  it("vídeo e alcance continuam em engajamento", () => {
    for (const goal of ["THRUPLAY", "VIDEO_VIEWS", "REACH", "POST_ENGAGEMENT"]) {
      expect(suggestCampaignBlock(undefined, goal)).toBe("engajamento");
    }
  });

  it("sem evidência nenhuma, `outro` — nunca um palpite inventado", () => {
    expect(suggestCampaignBlock()).toBe("outro");
    expect(suggestCampaignBlock("OUTCOME_APP_PROMOTION")).toBe("outro");
  });
});
