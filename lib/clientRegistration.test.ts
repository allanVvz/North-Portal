import { describe, expect, it } from "vitest";
import { adminCreateClientSchema, companyInfoSchema, contractSchema, scopeItemSchema } from "./validation";
import { slugifyScopeKey } from "./supabase";
import { parseValorMensal } from "@/app/admin/clientForm";

// Covers the cadastro payload contract: the shapes the form sends and the ones
// the API must refuse.

describe("scopeItemSchema", () => {
  it("accepts a bare tag and a tag with quantity", () => {
    expect(scopeItemSchema.parse({ key: "social_media" }).quantity).toBeUndefined();
    expect(scopeItemSchema.parse({ key: "carrosseis", quantity: 3 }).quantity).toBe(3);
  });

  it("rejects negative and fractional quantities", () => {
    expect(scopeItemSchema.safeParse({ key: "carrosseis", quantity: -1 }).success).toBe(false);
    expect(scopeItemSchema.safeParse({ key: "carrosseis", quantity: 1.5 }).success).toBe(false);
  });
});

describe("contractSchema", () => {
  it("accepts the full contract card", () => {
    const parsed = contractSchema.parse({
      planoTier: "growth",
      escopo: [{ key: "criativos" }],
      valorMensal: 3200,
      contractStart: "2026-07-01",
      responsavelNome: "Marcos",
      responsavelWhatsapp: "(42) 99841-2207",
    });
    expect(parsed.planoTier).toBe("growth");
  });

  it("rejects an unknown plan tier", () => {
    expect(contractSchema.safeParse({ planoTier: "enterprise" }).success).toBe(false);
  });

  it("rejects a date that is not YYYY-MM-DD", () => {
    expect(contractSchema.safeParse({ contractStart: "01/07/2026" }).success).toBe(false);
  });

  it("allows clearing fields with null", () => {
    expect(contractSchema.safeParse({ planoTier: null, valorMensal: null }).success).toBe(true);
  });
});

describe("adminCreateClientSchema", () => {
  const base = { slug: "baita-conveniencia", name: "Baita Conveniência", email: "baita@north.test" };

  it("accepts the minimum payload", () => {
    expect(adminCreateClientSchema.parse(base).slug).toBe("baita-conveniencia");
  });

  it("accepts the full cadastro payload", () => {
    const parsed = adminCreateClientSchema.parse({
      ...base,
      is_active: true,
      companyInfo: { segmento: "Conveniência", cidadeUf: "Ponta Grossa / PR", instagramOuSite: "@baita" },
      contract: { planoTier: "growth", escopo: [{ key: "carrosseis", quantity: 3 }] },
      checkpointTemplateIds: ["3f1a2b6c-0000-4000-8000-000000000000"],
      createDriveFolder: true,
      adAccountId: "act_123",
    });
    expect(parsed.contract?.escopo?.[0].quantity).toBe(3);
  });

  it("rejects an invalid slug and a non-uuid checkpoint id", () => {
    expect(adminCreateClientSchema.safeParse({ ...base, slug: "Baita Conveniencia" }).success).toBe(false);
    expect(adminCreateClientSchema.safeParse({ ...base, checkpointTemplateIds: ["nope"] }).success).toBe(false);
  });
});

describe("companyInfoSchema", () => {
  it("treats every field as optional and nullable", () => {
    expect(companyInfoSchema.safeParse({}).success).toBe(true);
    expect(companyInfoSchema.safeParse({ segmento: null }).success).toBe(true);
  });
});

describe("slugifyScopeKey", () => {
  it("strips accents instead of turning them into separators", () => {
    expect(slugifyScopeKey("Captação")).toBe("captacao");
    expect(slugifyScopeKey("Carrosséis")).toBe("carrosseis");
  });

  it("collapses punctuation and trims separators", () => {
    expect(slugifyScopeKey("  Social media / ADS  ")).toBe("social_media_ads");
  });
});

describe("parseValorMensal", () => {
  it("reads the currency formats an admin actually types", () => {
    expect(parseValorMensal("R$ 3.200")).toBe(3200);
    expect(parseValorMensal("3200")).toBe(3200);
    expect(parseValorMensal("3.200,50")).toBe(3200.5);
  });

  it("returns null when empty", () => {
    expect(parseValorMensal("")).toBeNull();
    expect(parseValorMensal("R$ ")).toBeNull();
  });
});
