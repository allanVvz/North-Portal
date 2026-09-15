import { describe, expect, it } from "vitest";
import { parseCommand } from "./commandParser";

const clients = [
  { slug: "tock-fatal", name: "Tock Fatal" },
  { slug: "baita", name: "Baita" },
  { slug: "baita-conveniencia", name: "Baita Conveniência" },
];
const today = "2026-09-15";

describe("parseCommand", () => {
  it("lê quantidades por formato, data, cliente e a intenção da diária", () => {
    const parsed = parseCommand("3 reels e 2 carrosséis, gravação 22/09 Tock Fatal", { clients, today });
    expect(parsed).toMatchObject({
      intent: "diaria",
      counts: { reels: 3, carrossel: 2 },
      dates: ["2026-09-22"],
      clientSlug: "tock-fatal",
    });
  });

  it("prefere o nome de cliente mais longo e separa os links", () => {
    const parsed = parseCommand("roteiros da Baita Conveniência https://docs.google.com/document/d/abc/edit", { clients, today });
    expect(parsed.clientSlug).toBe("baita-conveniencia");
    expect(parsed.links).toEqual(["https://docs.google.com/document/d/abc/edit"]);
  });

  it("reconhece rotina com cadência e dia da semana", () => {
    const parsed = parseCommand("rotina semanal toda quarta de reunião com Baita", { clients, today });
    expect(parsed).toMatchObject({ intent: "rotina", cadence: "semanal", weekdays: [3], clientSlug: "baita" });
  });

  it("dd/mm muito no passado é do ano seguinte; datas inválidas são ignoradas", () => {
    expect(parseCommand("gravação 10/01", { clients, today }).dates).toEqual(["2027-01-10"]);
    expect(parseCommand("gravação 31/02", { clients, today }).dates).toEqual([]);
  });

  it("só quantidades sem palavra de intenção: com data é diária, sem data é plano", () => {
    expect(parseCommand("4 reels 20/09", { clients, today }).intent).toBe("diaria");
    expect(parseCommand("4 reels 1 banner", { clients, today }).intent).toBe("plano");
  });
});
