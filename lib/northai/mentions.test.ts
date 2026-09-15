import { describe, expect, it } from "vitest";
import { filterClients, findMentionQuery, pickerKey, removeMentionQuery } from "./mentions";

const clients = [
  { id: "1", slug: "bruno-inovaut", name: "Bruno Inovaut" },
  { id: "2", slug: "tock-fatal", name: "Tock Fatal" },
  { id: "3", slug: "baita-conveniencia", name: "Baita Conveniência" },
];

describe("@cliente no composer", () => {
  it("abre com @ sozinho e acompanha a consulta; e-mail e quebra de linha não abrem", () => {
    expect(findMentionQuery("@", 1)).toEqual({ start: 0, end: 1, query: "" });
    expect(findMentionQuery("cria uma diária @Tock", 21)).toEqual({ start: 16, end: 21, query: "Tock" });
    expect(findMentionQuery("allan@north.com", 15)).toBeNull();
    expect(findMentionQuery("@Tock\nfoo", 9)).toBeNull();
  });

  it("“@Tock” filtra a Tock Fatal; acento e slug funcionam", () => {
    expect(filterClients(clients, "Tock").map((c) => c.name)).toEqual(["Tock Fatal"]);
    expect(filterClients(clients, "conven").map((c) => c.id)).toEqual(["3"]);
    expect(filterClients(clients, "fatal").map((c) => c.id)).toEqual(["2"]);
    expect(filterClients(clients, "").map((c) => c.name)).toEqual(["Baita Conveniência", "Bruno Inovaut", "Tock Fatal"]);
  });

  it("escolher a menção tira o “@consulta” do texto sem perder o resto", () => {
    expect(removeMentionQuery("@Tock 3 reels", { start: 0, end: 5, query: "Tock" })).toEqual({ text: "3 reels", caret: 0 });
    expect(removeMentionQuery("3 reels @Tock", { start: 8, end: 13, query: "Tock" })).toEqual({ text: "3 reels", caret: 7 });
  });

  it("teclado: setas navegam com volta, Enter/Tab escolhem, Escape fecha; fechado não trata nada", () => {
    const open = { open: true, index: 0 };
    expect(pickerKey(open, "ArrowDown", 3).state.index).toBe(1);
    expect(pickerKey(open, "ArrowUp", 3).state.index).toBe(2);
    expect(pickerKey({ open: true, index: 2 }, "Enter", 3)).toMatchObject({ select: 2, handled: true, state: { open: false } });
    expect(pickerKey({ open: true, index: 1 }, "Tab", 3).select).toBe(1);
    expect(pickerKey(open, "Escape", 3)).toMatchObject({ select: null, handled: true, state: { open: false } });
    expect(pickerKey({ open: false, index: 0 }, "Enter", 3).handled).toBe(false);
  });
});
