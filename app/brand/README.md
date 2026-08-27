# Marca North — como mexer

A marca da North é **uma bússola monocromática**, e existe em **um só lugar**:
`app/brand/compass.ts`. Todo o resto — favicon, barra lateral do admin,
header/footer do site, login, capa do Manual do Cliente — lê daquele
arquivo. Não há segunda cópia da geometria para manter em sincronia.

## Quero trocar o desenho da marca

1. Edite a geometria em **`app/brand/compass.ts`** (só o array `compassShapes`).
2. Rode **`npm run brand:icons`**.
3. Pronto. React e favicon já estão em dia.

Não edite `app/icon.svg` à mão — ele é **gerado**.
Se alguém editar (ou mudar a geometria e esquecer o passo 2), `npm run verify`
falha em `lib/brand.test.ts` dizendo exatamente o que rodar. É de propósito: o
sintoma alternativo seria o favicon em produção discordando da marca do app, e
nenhum teste de UI pegaria isso.

## Quero trocar as cores

`app/brand/tokens.ts`. Depois rode `npm run brand:icons` (as cores estão
embutidas nos SVGs estáticos).

Atenção: esses literais valem **só** para o que não enxerga CSS — favicon,
apple-icon, imagens geradas no servidor. Dentro do app, a marca continua se
pintando por `currentColor`, herdado do CSS de cada contexto. É isso que faz a
mesma bússola funcionar em creme sobre petróleo (admin) e em sage sobre papel
(site claro) sem virar dois desenhos.

## Quero mudar o texto ou o tamanho do logo numa tela

`app/brand/BrandLockup.tsx`, no mapa `LOCKUPS`. Cada variante corresponde a uma
tela:

| Variante | Onde aparece | Composição |
|---|---|---|
| `admin` | barra lateral do admin | símbolo 16px + `NORTH` + `admin` |
| `site` | header do site público | símbolo 22px + `north` + `estratégia & operação` |
| `site-compact` | rodapé do site público | símbolo 22px + `north` |
| `auth` | tela de login | símbolo 18px + `north` + `Portal` |

Cada variante emite **as mesmas classes CSS que a tela já usava**
(`.admin-mark`, `.site-compass`, `.auth-mark`…), então o CSS de cada contexto
continua valendo sem alteração. O elemento de fora — o `<Link>`/`<div>` com
`.admin-brand` / `.site-brand` / `.auth-brand` — continua sendo de quem monta:
é ele que decide para onde a marca navega, e isso não é assunto da marca.

## Mapa dos arquivos

```
app/brand/
  compass.ts        ← FONTE ÚNICA: a geometria + o gerador de markup SVG
  tokens.ts         ← cores literais (só para SVG estático / OG)
  CompassMark.tsx   ← o símbolo em React (currentColor)
  BrandLockup.tsx   ← símbolo + nome + descritor, por tela
  README.md         ← este arquivo

scripts/generate-brand-icons.mjs  ← `npm run brand:icons`
lib/brand.test.ts                 ← guarda de divergência + invariantes
app/icon.svg                      ← GERADO (favicon)
```

O SVG gerado **é commitado** de propósito: o Next precisa dele em disco para
detectar a rota `/icon.svg` — não é um artefato de build que dá para gerar no
deploy.

**Sem ícone de iOS por enquanto.** A convenção `apple-icon` do Next só aceita
`.png/.jpg` (o iOS não lê SVG em touch icon), então gerar um exige um
rasterizador como dependência real do projeto. O favicon SVG cobre os
navegadores; quando o atalho no iOS virar prioridade, o caminho é adicionar
`sharp` como devDependency e uma entrada PNG em `GENERATED_ICONS`.

## Por que o script é `.mjs` importando `.ts`

Node 24 lê TypeScript direto (type stripping), então o gerador importa
**exatamente o mesmo módulo** que o app usa — sem passo de build no meio e sem
uma segunda cópia da geometria em JavaScript. É o que garante que "o que o
favicon desenha" e "o que o React desenha" não podem divergir por construção.

## Onde a marca aparece hoje

- `app/admin/AdminShell.tsx` — barra lateral (`BrandLockup variant="admin"`)
- `app/(site)/SiteFrame.tsx` — header e rodapé (`site` / `site-compact`)
- `app/login/page.tsx` — cartão de login (`auth`)
- `app/[slug]/ManualDoCliente.tsx` — capa do manual (`CompassMark size={150}`)
- `app/icon.svg` — favicon do navegador

Ao adicionar um lugar novo, use `BrandLockup` se for logo com texto, ou
`CompassMark` se for só o símbolo — e acrescente a linha nesta lista.
