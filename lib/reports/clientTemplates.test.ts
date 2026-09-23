import { describe, expect, it } from "vitest";
import { blockKpisOf, BLOCK_KPIS_DEFAULT } from "./campaignBlockKpis";
import { BUILTIN_PERFORMANCE_TEMPLATES, sanitizePerformanceTemplateConfig } from "@/lib/performanceTemplates";

// Os moldes por cliente existem para reproduzir, no PDF, o resumo que a operação
// manda por WhatsApp. Este arquivo fixa os rótulos e a ordem de cada um: se
// alguém mexer, o teste diz qual cliente passa a receber um relatório diferente.
//
// A divisão de trabalho entre os dois relatórios é a regra que sustenta tudo:
//   anúncios   → detalha o que a Marketing API entrega, e só isso
//   conversão  → análise, conversão e o que chega pelo comentário (seguidores,
//                verba disponível, vendas, receita)

const templateById = (id: string) => BUILTIN_PERFORMANCE_TEMPLATES.find((t) => t.id === id)!;
const labels = (id: string, block: Parameters<typeof blockKpisOf>[1]) =>
  blockKpisOf(templateById(id).config, block).map((k) => k.label);

describe("moldes por perfil de cliente", () => {
  it("Perfil — negócio local detalha o que a API entrega, e só isso", () => {
    // Do resumo da operação ("290 visitas / custo por visita R$ 0,20 /
    // investimento R$ 58,27 / alcance 3.599 / 66 novos seguidores / custo por
    // novo seguidor R$ 0,88"), os quatro primeiros vêm da Marketing API e ficam
    // aqui; os dois de seguidores vivem no relatório de CONVERSÃO, porque o
    // número chega pelo comentário e não pela API.
    // Frequência saiu como métrica fixa (22/09): só aparece quando for um
    // fator preocupante, o que ainda não está implementado (roadmap).
    expect(labels("builtin-perfil-negocio-local", "trafego_perfil")).toEqual([
      "Visitas ao perfil", "Custo por visita", "Investimento", "Alcance", "CPM",
    ]);
  });

  it("nenhum molde põe seguidores no relatório de anúncios", () => {
    // A regra: cada relatório mede o que pode provar. Um card de seguidores no
    // bloco de anúncios sairia sempre vazio — a API não entrega follows.
    for (const t of BUILTIN_PERFORMANCE_TEMPLATES) {
      for (const defs of Object.values(t.config.blockKpis)) {
        const refs = (defs ?? []).flatMap((k) => [k.metric, ...(k.ratio ?? [])]);
        expect(refs, `${t.id} referencia followersGained`).not.toContain("followersGained");
      }
    }
  });

  it("negócio local não declara site nem mensagens — cai no padrão se aparecer campanha assim", () => {
    // Não bloquear: uma campanha inesperada precisa sair com números, não em branco.
    const config = templateById("builtin-perfil-negocio-local").config;
    expect(config.blockKpis.trafego_site).toBeUndefined();
    expect(blockKpisOf(config, "trafego_site")).toEqual([]);
  });

  it("Estética automotiva traz os três blocos (Karpinski, UTZIG, FALKE, CRIS)", () => {
    expect(labels("builtin-estetica-automotiva", "trafego_perfil")).toEqual([
      "Visitas ao perfil", "Custo por visita", "Investimento", "Alcance", "CPM",
    ]);
    expect(labels("builtin-estetica-automotiva", "trafego_site")).toEqual([
      "Investimento", "Alcance", "Cliques no link", "Custo por clique",
    ]);
    expect(labels("builtin-estetica-automotiva", "mensagens")).toEqual([
      "Investimento", "Alcance", "Novas conversas", "Custo por conversa",
    ]);
  });

  it('"Novas conversas" em vez de "Mensagens" — é como a operação conta o desfecho', () => {
    expect(BLOCK_KPIS_DEFAULT.mensagens.map((k) => k.label)).toContain("Mensagens");
    expect(labels("builtin-estetica-automotiva", "mensagens")).not.toContain("Mensagens");
  });
  it("E-commerce accepts only the CRIS operational blocks", () => {
    expect(labels("builtin-ecommerce", "trafego_site")).toEqual([
      "Investimento", "Alcance", "Cliques no link",
    ]);
    expect(labels("builtin-ecommerce", "trafego_perfil")).toEqual([
      "Investimento", "Alcance", "Visitas ao perfil", "Custo por visita",
    ]);
    expect(labels("builtin-ecommerce", "mensagens")).toEqual([
      "Investimento", "Alcance", "Novas conversas", "Custo por conversa",
    ]);
    expect(blockKpisOf(templateById("builtin-ecommerce").config, "engajamento")).toEqual([]);
  });
});

describe("blockKpis como dado de entrada", () => {
  it("rótulo vazio, métrica inexistente e razão malformada são descartados", () => {
    const config = sanitizePerformanceTemplateConfig({
      blockKpis: {
        trafego_perfil: [
          { label: "Visitas", metric: "profileVisits" },
          { label: "   ", metric: "custo" },
          { label: "Inventada", metric: "naoExiste" },
          { label: "Razão torta", ratio: ["custo"] },
          { label: "Custo por visita", ratio: ["custo", "profileVisits"] },
        ],
        bloco_inexistente: [{ label: "x", metric: "custo" }],
      },
    });
    expect(config.blockKpis.trafego_perfil?.map((k) => k.label)).toEqual(["Visitas", "Custo por visita"]);
    expect(Object.keys(config.blockKpis)).toEqual(["trafego_perfil"]);
  });

  it("bloco que sobra vazio não sequestra o padrão", () => {
    const config = sanitizePerformanceTemplateConfig({ blockKpis: { mensagens: [{ label: "só ruído" }] } });
    expect(config.blockKpis.mensagens).toBeUndefined();
    expect(blockKpisOf(config, "mensagens")).toEqual(BLOCK_KPIS_DEFAULT.mensagens);
  });

  it("no máximo 8 KPIs por bloco", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ label: `KPI ${i}`, metric: "custo" }));
    const config = sanitizePerformanceTemplateConfig({ blockKpis: { outro: many } });
    expect(config.blockKpis.outro).toHaveLength(8);
  });

  it("E-commerce rejects metrics outside the operational summary", () => {
    const config = sanitizePerformanceTemplateConfig({
      reportKpiPolicy: "ecommerce",
      blockKpis: {
        trafego_site: [
          { label: "Investimento", metric: "custo" },
          { label: "Landing page", metric: "landingPageViews" },
          { label: "CTR", metric: "ctr" },
          { label: "Custo por clique", ratio: ["custo", "cliquesLink"] },
        ],
        trafego_perfil: [
          { label: "Visitas ao perfil", metric: "profileVisits" },
          { label: "Cliques no link", metric: "cliquesLink" },
        ],
      },
    });
    expect(config.blockKpis.trafego_site?.map((k) => k.label)).toEqual(["Investimento"]);
    expect(config.blockKpis.trafego_perfil?.map((k) => k.label)).toEqual(["Visitas ao perfil"]);
  });
});
