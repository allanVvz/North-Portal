import { describe, expect, it } from "vitest";
import { sortItems, type SortFields } from "./taskSort";

type Row = SortFields & { id: string };

const pick = (row: Row): SortFields => row;

function row(id: string, fields: Partial<SortFields> = {}): Row {
  return {
    id,
    title: fields.title ?? id,
    updatedAt: fields.updatedAt ?? "2026-08-01T00:00:00.000Z",
    dueDate: fields.dueDate === undefined ? "2026-08-10" : fields.dueDate,
    position: fields.position ?? 0,
  };
}

const ids = (rows: Row[]) => rows.map((r) => r.id);

describe("sortItems", () => {
  it("ordena alfabeticamente respeitando acentuação pt-BR", () => {
    const rows = [row("c", { title: "Cronograma" }), row("a", { title: "Áudio" }), row("b", { title: "Briefing" })];
    expect(ids(sortItems(rows, "alfabetico", "asc", pick))).toEqual(["a", "b", "c"]);
    expect(ids(sortItems(rows, "alfabetico", "desc", pick))).toEqual(["c", "b", "a"]);
  });

  // Caso real de produção: "KARPINSKI -  GRAVAÇÃO" tem espaço duplo. O
  // navegador colapsa ao renderizar, então ordenar pela string crua fazia o
  // card saltar para o topo por um motivo invisível na tela.
  it("ignora espaço extra que o navegador colapsa ao renderizar", () => {
    const rows = [
      row("gravacao", { title: "KARPINSKI -  GRAVAÇÃO" }),
      row("assessoria", { title: "KARPINSKI - ASSESSORIA COMERCIAL" }),
      row("checklist", { title: "KARPINSKI - CHECKLIST SEMANAL" }),
    ];
    expect(ids(sortItems(rows, "alfabetico", "asc", pick))).toEqual(["assessoria", "checklist", "gravacao"]);
  });

  it("ignora espaço no início do título", () => {
    const rows = [row("b", { title: "  Beta" }), row("a", { title: "Alfa" })];
    expect(ids(sortItems(rows, "alfabetico", "asc", pick))).toEqual(["a", "b"]);
  });

  it("coloca a última edição no topo em desc", () => {
    const rows = [
      row("velho", { updatedAt: "2026-08-01T10:00:00.000Z" }),
      row("novo", { updatedAt: "2026-08-18T10:00:00.000Z" }),
      row("meio", { updatedAt: "2026-08-09T10:00:00.000Z" }),
    ];
    expect(ids(sortItems(rows, "edicao", "desc", pick))).toEqual(["novo", "meio", "velho"]);
    expect(ids(sortItems(rows, "edicao", "asc", pick))).toEqual(["velho", "meio", "novo"]);
  });

  it("coloca o prazo mais próximo no topo em asc", () => {
    const rows = [row("depois", { dueDate: "2026-09-01" }), row("hoje", { dueDate: "2026-08-19" }), row("antes", { dueDate: "2026-08-20" })];
    expect(ids(sortItems(rows, "data", "asc", pick))).toEqual(["hoje", "antes", "depois"]);
  });

  // A invariante que a inversão de direção não pode quebrar: um card sem prazo
  // nunca é a coisa mais urgente do quadro.
  it("mantém cards sem data no fim nas DUAS direções", () => {
    const rows = [row("sem", { dueDate: null }), row("tarde", { dueDate: "2026-09-01" }), row("cedo", { dueDate: "2026-08-02" })];
    expect(ids(sortItems(rows, "data", "asc", pick))).toEqual(["cedo", "tarde", "sem"]);
    expect(ids(sortItems(rows, "data", "desc", pick))).toEqual(["tarde", "cedo", "sem"]);
  });

  it("agrupa todos os sem-data no fim preservando a ordem entre eles", () => {
    const rows = [row("s1", { dueDate: null }), row("com", { dueDate: "2026-08-02" }), row("s2", { dueDate: null })];
    expect(ids(sortItems(rows, "data", "desc", pick))).toEqual(["com", "s1", "s2"]);
  });

  it("usa position na ordem manual", () => {
    const rows = [row("c", { position: 20 }), row("a", { position: 0 }), row("b", { position: 10 })];
    expect(ids(sortItems(rows, "manual", "asc", pick))).toEqual(["a", "b", "c"]);
    expect(ids(sortItems(rows, "manual", "desc", pick))).toEqual(["c", "b", "a"]);
  });

  // Sem isso o board reembaralha cards equivalentes a cada re-render.
  it("é estável: empate preserva a ordem de entrada, inclusive em desc", () => {
    const same = { updatedAt: "2026-08-01T00:00:00.000Z" };
    const rows = [row("primeiro", same), row("segundo", same), row("terceiro", same)];
    expect(ids(sortItems(rows, "edicao", "asc", pick))).toEqual(["primeiro", "segundo", "terceiro"]);
    expect(ids(sortItems(rows, "edicao", "desc", pick))).toEqual(["primeiro", "segundo", "terceiro"]);
  });

  it("não muta o array recebido", () => {
    const rows = [row("b", { title: "B" }), row("a", { title: "A" })];
    sortItems(rows, "alfabetico", "asc", pick);
    expect(ids(rows)).toEqual(["b", "a"]);
  });

  it("aceita lista vazia", () => {
    expect(sortItems([], "data", "asc", pick)).toEqual([]);
  });
});
