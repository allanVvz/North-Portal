import { describe, expect, it } from "vitest";
import { DEFAULT_BUILTIN_TEMPLATE, type CampaignBlock, type PerformanceTemplateConfig } from "@/lib/performanceTemplates";
import type { MetaPost } from "@/lib/windsor";
import { blockResolver } from "./campaignBlockKpis";

const config = (campaignBlocks: Record<string, CampaignBlock> = {}): PerformanceTemplateConfig => ({
  ...DEFAULT_BUILTIN_TEMPLATE.config,
  campaignBlocks,
});

const ad = (over: Partial<MetaPost> = {}): MetaPost => ({
  id: over.id ?? "ad-1",
  date: "2026-09-15",
  accountId: "account-1",
  accountName: "Conta",
  platform: "instagram",
  source: "paid",
  type: "imagem",
  caption: "Criativo",
  permalink: null,
  metrics: {},
  campaignId: "campaign-1",
  campaignName: "Campanha",
  ...over,
});

describe("blockResolver", () => {
  it("configuração manual vence todas as evidências, inclusive quando salva pelo nome", () => {
    const ads = [ad({ optimizationGoal: "PROFILE_VISIT" })];
    const { blockOf } = blockResolver(config({ Campanha: "mensagens" }), ads);

    expect(blockOf("campaign-1", "Campanha", "LINK_CLICKS", "LANDING_PAGE_VIEWS")).toBe("mensagens");
  });

  it.each(["PROFILE_VISIT", "PROFILE_VISITS", "PAGE_PROFILE", "INSTAGRAM_PROFILE_VISITS"])(
    "%s no anúncio vence LINK_CLICKS da campanha",
    (optimizationGoal) => {
      const { blockOf } = blockResolver(config(), [ad({ optimizationGoal })]);

      expect(blockOf("campaign-1", "Aquisição site", "LINK_CLICKS", "LINK_CLICKS")).toBe("trafego_perfil");
    },
  );

  it("segue goal da linha, objective e nome somente quando a evidência anterior é inconclusiva", () => {
    const unknownAd = ad({ optimizationGoal: "NONE" });
    const { blockOf } = blockResolver(config(), [unknownAd]);

    expect(blockOf("campaign-1", "Perfil", "PROFILE_VISIT", "CONVERSATIONS")).toBe("mensagens");
    expect(blockOf("campaign-2", "Nome neutro", "LANDING_PAGE_VIEWS", "NONE")).toBe("trafego_site");
    expect(blockOf("campaign-3", "Ganhar seguidores", "UNKNOWN", "NONE")).toBe("trafego_perfil");
  });

  it("mantém campanhas de perfil e site em blocos distintos no mesmo período", () => {
    const ads = [
      ad({ id: "profile-ad", campaignId: "profile", campaignName: "Baita", optimizationGoal: "PROFILE_VISIT" }),
      ad({ id: "site-ad", campaignId: "site", campaignName: "Landing", optimizationGoal: "LANDING_PAGE_VIEWS" }),
    ];
    const { postBlock } = blockResolver(config(), ads);

    expect(postBlock(ad({ campaignId: "profile", campaignName: "Baita", objective: "LINK_CLICKS" }))).toBe("trafego_perfil");
    expect(postBlock(ad({ campaignId: "site", campaignName: "Landing", objective: "LINK_CLICKS" }))).toBe("trafego_site");
  });
});
