import { describe, expect, it } from "vitest";
import { isNavItemActive, resolveActivePathname } from "./navActive";

const SECTION_HREFS = ["/admin/home", "/admin/clientes", "/admin/operacao", "/admin/revisoes", "/admin/aprovacoes", "/admin/performance", "/admin/documentos", "/admin/northai", "/admin/configuracoes", "/admin/notificacoes"];

describe("resolveActivePathname", () => {
  it("resolve /admin/kanban para a rota de Operação; o resto passa direto", () => {
    expect(resolveActivePathname("/admin/kanban")).toBe("/admin/operacao");
    expect(resolveActivePathname("/admin/operacao")).toBe("/admin/operacao");
    expect(resolveActivePathname("/admin/clientes")).toBe("/admin/clientes");
  });
});

describe("isNavItemActive", () => {
  it("bug reproduzido: /admin/kanban acende Operação, nunca Clientes", () => {
    expect(isNavItemActive("/admin/kanban", "/admin/operacao", SECTION_HREFS)).toBe(true);
    expect(isNavItemActive("/admin/kanban", "/admin/clientes", SECTION_HREFS)).toBe(false);
  });

  it("/admin/operacao continua ativo por si mesmo, com ou sem querystring de rota (o pathname já vem sem query)", () => {
    expect(isNavItemActive("/admin/operacao", "/admin/operacao", SECTION_HREFS)).toBe(true);
  });

  it("Clientes continua o fallback de /admin/novo e /admin/<slug>(/visao)", () => {
    expect(isNavItemActive("/admin/novo", "/admin/clientes", SECTION_HREFS)).toBe(true);
    expect(isNavItemActive("/admin/tock-fatal", "/admin/clientes", SECTION_HREFS)).toBe(true);
    expect(isNavItemActive("/admin/tock-fatal/visao", "/admin/clientes", SECTION_HREFS)).toBe(true);
  });

  it("uma rota de section não cai no fallback de Clientes", () => {
    expect(isNavItemActive("/admin/operacao", "/admin/clientes", SECTION_HREFS)).toBe(false);
    expect(isNavItemActive("/admin/northai/automacoes", "/admin/clientes", SECTION_HREFS)).toBe(false);
    expect(isNavItemActive("/admin/northai/automacoes", "/admin/northai", SECTION_HREFS)).toBe(true);
  });

  it("nada fora de /admin/ ativa qualquer item", () => {
    expect(isNavItemActive("/login", "/admin/clientes", SECTION_HREFS)).toBe(false);
  });
});
