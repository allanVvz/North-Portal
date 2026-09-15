import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCommand } from "./commandParser";
import { applyCommand, applyPrefill, buildRecipe, initialDrafts } from "./drafts";

const today = "2026-09-15";
const clients = [{ slug: "tock-fatal", name: "Tock Fatal" }, { slug: "baita", name: "Baita" }];
const env = { client: clients[0], deliveryTypes: [{ key: "criativo", label: "Entrega" }], routines: [], today };
const fresh = () => initialDrafts(today, { shootTypeKey: "criativo", deliveryTypeKey: "criativo" });

afterEach(() => vi.restoreAllMocks());

describe("regressão: “3 reels e 1 carrossel, gravação 22/09 Tock Fatal”", () => {
  it("vira uma diária preenchida com a prévia certa — sem chamar a rede", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const text = "3 reels e 1 carrossel, gravação 22/09 Tock Fatal";
    const parsed = parseCommand(text, { clients, today });
    expect(parsed.intent).toBe("diaria");
    expect(parsed.clientSlug).toBe("tock-fatal");

    const { drafts, intent, understood } = applyCommand(fresh(), parsed, text);
    expect(intent).toBe("diaria");
    expect(understood).toBe("Entendi: diária de gravação em 22/09 com 3 Reels e 1 Carrossel. Confira as peças e as datas.");
    expect(drafts.diaria.shootDate).toBe("2026-09-22");
    expect(drafts.diaria.pieces.map((piece) => piece.format)).toEqual(["reels", "reels", "reels", "carrossel"]);

    const built = buildRecipe("diaria", drafts, env);
    expect(built.problem).toBeNull();
    const day = built.value!.blueprint.ops.find((op) => op.op === "createShootDay");
    if (!day || day.op !== "createShootDay") throw new Error("esperava a diária");
    expect(day.pieces.map((piece) => [piece.formato, piece.publishDate])).toEqual([
      ["Reels vertical", "2026-09-28"],
      ["Reels vertical", "2026-09-30"],
      ["Reels vertical", "2026-10-02"],
      ["Carrossel", "2026-10-04"],
    ]);
    const lines = built.value!.preview.map((line) => `${line.group}: ${line.text}`);
    expect(lines).toContain("Compartilhado: Roteiro — vence 18/09");
    expect(lines).toContain("Compartilhado: Captação — 22/09");
    expect(lines).toContain("Depois da captação: 4 edições serão criadas automaticamente");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("rascunhos", () => {
  it("sem cliente não há plano a revisar", () => {
    expect(buildRecipe("rotina", fresh(), { ...env, client: null }).problem).toBe("Escolha o cliente.");
  });

  it("“Resolver” de rotina padrão leva a chave estável até o card", () => {
    const drafts = applyPrefill(fresh(), "rotina", { title: "Reunião de kickoff", description: "x", cadence: null, routineKey: "reuniao_kickoff" });
    const op = buildRecipe("rotina", drafts, env).value!.blueprint.ops[0];
    expect(op).toMatchObject({ scope: "task", task: { title: "Reunião de kickoff", routineKey: "reuniao_kickoff" } });
  });

  it("pedido sem intenção não muda o rascunho", () => {
    const drafts = fresh();
    const result = applyCommand(drafts, parseCommand("bom dia", { clients, today }), "bom dia");
    expect(result.intent).toBeNull();
    expect(result.drafts).toBe(drafts);
  });
});
