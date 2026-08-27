// Gera os arquivos de ícone estáticos a partir da geometria única da marca
// (app/brand/compass.ts). Rode `npm run brand:icons` depois de mexer no
// desenho ou nas cores da marca.
//
// Os arquivos gerados são commitados — o Next precisa deles em disco para
// detectar a rota /icon.svg. lib/brand.test.ts garante que
// o que está commitado é o que este script produz hoje, então um desenho
// alterado sem regenerar quebra o `npm run verify` em vez de sair em produção
// com o favicon velho.
//
// Node 24 importa .ts direto (type stripping), então o script lê exatamente o
// mesmo módulo que o app usa — sem build intermediário e sem cópia da
// geometria.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { compassSvgMarkup } from "../app/brand/compass.ts";
import { FAVICON } from "../app/brand/tokens.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Os ícones estáticos e como cada um é pintado.
 * Para adicionar um novo tamanho/variante, acrescente uma entrada aqui e
 * inclua o caminho em lib/brand.test.ts.
 */
export const GENERATED_ICONS = [
  {
    file: "app/icon.svg",
    options: { ...FAVICON, size: 32 },
    note: "favicon da aba do navegador",
  },
];

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("generate-brand-icons.mjs")) {
  for (const icon of GENERATED_ICONS) {
    const svg = compassSvgMarkup(icon.options);
    writeFileSync(join(repoRoot, icon.file), svg, "utf8");
    console.log(`  escrito  ${icon.file}  (${icon.note})`);
  }
  console.log("Ícones da marca regenerados a partir de app/brand/compass.ts.");
}
