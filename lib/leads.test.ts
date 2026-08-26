import { describe, expect, it } from "vitest";
import { createWhatsAppUrl, leadSchema, normalizeBrazilPhone } from "./leads";

describe("leads", () => {
  it("normaliza telefones brasileiros sem expor dados ao analytics", () => { expect(normalizeBrazilPhone("(19) 99999-1234")).toBe("+5519999991234"); expect(normalizeBrazilPhone("+55 19 99999-1234")).toBe("+5519999991234"); });
  it("rejeita honeypot preenchido e investimento fora da lista", () => { expect(leadSchema.safeParse({ name:"Ana",company:"Loja",phone:"19999991234",segment:"Gastronomia",region:"Campinas",objective:"Gerar demanda local",investment:"qualquer",website:"bot",source_page:"/",consent_analytics:false,utm:{} }).success).toBe(false); });
  it("monta URL contextual do WhatsApp", () => { const url=createWhatsAppUrl("5511999999999","abc",{name:"Ana",company:"Aurora",segment:"Serviços",region:"Santos",objective:"Crescer"}); expect(url).toContain("wa.me/5511999999999"); expect(decodeURIComponent(url)).toContain("diagnóstico abc"); });
});
