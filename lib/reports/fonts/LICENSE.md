# Fontes vendorizadas — PDF da automação

Estes `.ttf` existem porque o `@react-pdf/renderer` só enxerga arquivos de fonte
locais (não tem CSS, não tem `@font-face`). São os mesmos rostos que a tela de
Performance usa (Inter no corpo, Fraunces nos números grandes).

| arquivo | família | licença | origem |
|---|---|---|---|
| `Inter-Regular.ttf`, `Inter-SemiBold.ttf`, `Inter-Bold.ttf` | Inter | SIL Open Font License 1.1 | https://github.com/rsms/inter (release v4.1, `extras/ttf/`) |
| `Fraunces72pt-Regular.ttf`, `Fraunces72pt-SemiBold.ttf` | Fraunces (corte óptico 72pt, para display) | SIL Open Font License 1.1 | https://github.com/undercasetype/Fraunces (`fonts/ttf/`) |

A OFL-1.1 permite redistribuição, inclusive embutida. Texto completo:
https://openfontlicense.org/open-font-license-official-text/

Só o subconjunto de pesos que o PDF usa. Para trocar/adicionar peso: baixar da
mesma origem, pôr aqui, e registrar em `lib/reports/reportFonts.ts`.
