import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { compassShapes, compassSvgMarkup, COMPASS_VIEWBOX } from "../app/brand/compass";
import { FAVICON } from "../app/brand/tokens";

// Guarda de divergência da marca.
//
// app/icon.svg é um arquivo gerado, mas fica commitado
// (o Next precisa dele em disco). Nada impede alguém de editá-lo à mão,
// ou de mudar a geometria e esquecer de rodar `npm run brand:icons` — e o
// sintoma seria o favicon em produção discordando da marca do app, algo que
// nenhum teste de UI pegaria.
//
// Estes testes falham o `npm run verify` nesse caso, com a instrução do que
// rodar.
const REGENERATE = "rode `npm run brand:icons` para regerar";

const ICONS = [
  { file: "app/icon.svg", options: { ...FAVICON, size: 32 } },
];

describe("marca · ícones gerados", () => {
  for (const icon of ICONS) {
    it(`${icon.file} está em dia com app/brand/compass.ts`, () => {
      const committed = readFileSync(join(process.cwd(), icon.file), "utf8").replace(/\r\n/g, "\n");
      expect(committed, `${icon.file} saiu do passo com a geometria da marca — ${REGENERATE}`).toBe(
        compassSvgMarkup(icon.options),
      );
    });
  }
});

describe("marca · geometria", () => {
  it("desenha tudo dentro do viewBox", () => {
    // Uma forma que vaze o quadrado aparece cortada só em alguns tamanhos, o
    // que é o tipo de bug que passa despercebido no favicon de 16px.
    for (const shape of compassShapes) {
      const points: number[] =
        shape.kind === "spoke"
          ? [shape.x1, shape.y1, shape.x2, shape.y2]
          : shape.kind === "blade"
            ? (shape.d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)
            : [shape.cx - shape.r, shape.cx + shape.r, shape.cy - shape.r, shape.cy + shape.r];

      for (const value of points) {
        expect(value, `forma ${shape.kind} sai do viewBox`).toBeGreaterThanOrEqual(0);
        expect(value, `forma ${shape.kind} sai do viewBox`).toBeLessThanOrEqual(COMPASS_VIEWBOX);
      }
    }
  });

  it("é monocromática — nenhuma forma carrega cor própria", () => {
    // A marca inteira se pinta com uma tinta só (`currentColor` no React, a cor
    // literal no favicon). Se alguém embutir um hex numa forma, ela para de se
    // adaptar ao contexto claro/escuro sem ninguém perceber.
    const markup = compassSvgMarkup({ ink: "TINTA" });
    expect(markup).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(markup.match(/TINTA/g)?.length).toBe(compassShapes.length);
  });
});
