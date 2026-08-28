# Marca North — como mexer

A marca da North é **uma bússola monocromática**, e existe em **um só lugar**:
`app/brand/compass.ts`. Todo o resto — favicon, barra lateral do admin,
header/footer do site, **telas de login**, portal do cliente, capa do Manual do
Cliente — lê daquele arquivo. Não há segunda cópia da geometria para manter em
sincronia.

Antes de mexer, olhe o **[mapa completo](#onde-a-marca-aparece-hoje)** no fim
deste arquivo: ele lista *todas* as telas que exibem a marca, inclusive as duas
que já divergem de propósito. Uma tela que exibe a marca e não está no mapa é
bug de documentação — acrescente a linha junto com o código.

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
| `auth` | telas de login: `/login` **e** `/recuperar-senha` | símbolo 18px + `north` + `Portal` |

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

Este é o mapa fechado. Toda tela que desenha a bússola ou escreve "north" está
aqui — se você adicionar uma, acrescente a linha no mesmo commit.

| Tela | Arquivo | O que exibe | Vem da fonte única? |
|---|---|---|---|
| Admin — barra lateral | `app/admin/AdminShell.tsx` | `BrandLockup variant="admin"` | sim |
| Site público — header | `app/(site)/SiteFrame.tsx` | `BrandLockup variant="site"` | sim |
| Site público — rodapé | `app/(site)/SiteFrame.tsx` | `BrandLockup variant="site-compact"` | sim |
| **Login** (`/login`) | `app/login/page.tsx` | `BrandLockup variant="auth"` dentro de `.auth-brand` | sim |
| **Recuperar senha** (`/recuperar-senha`) | `app/recuperar-senha/page.tsx` | `BrandLockup variant="auth"`, o mesmo lockup do login | sim |
| Portal do cliente — header, overlay, café, rodapé | `app/[slug]/PortalPaged.tsx` | `CompassMark` 22px/14px em `.np-logo-dot` | símbolo sim, texto **não** |
| Manual do Cliente — capa | `app/[slug]/ManualDoCliente.tsx` | `CompassMark size={150}` | sim |
| Favicon da aba | `app/icon.svg` (gerado) | bússola creme sobre placa petróleo | sim |
| Cartão social (OG) | `app/opengraph-image.tsx` | só a palavra `NORTH`, **sem** bússola | **não** |
| 404 | `app/not-found.tsx` | nada — sem marca, de propósito (Figma 411:1734) | — |

### As telas de login

As duas telas de autenticação usam **a mesma variante `auth`** — símbolo 18px +
`north` + `Portal` —, montada uma vez em `BrandLockup.tsx` e não em cada página.
Cada página só fornece o invólucro `.auth-brand`; a tinta do símbolo vem de
`.auth-mark { color: var(--l-teal) }` em `app/globals.css`, o que faz a bússola
acompanhar o tema claro/escuro da tela sem virar um segundo desenho.

Consequência prática: **mudar a marca do login é mexer em `LOCKUPS.auth`**, e as
duas telas mudam juntas. Não edite o JSX de `app/login/page.tsx` para isso — se
a alteração couber só numa das duas, ela vira uma variante nova no mapa
`LOCKUPS`, nunca um lockup solto na página.

### As duas divergências conhecidas

Estão documentadas porque **não** são descuido de quem passar por aqui — são
dívida assumida, com o caminho de saída escrito:

- **Portal do cliente** (`PortalPaged.tsx`, 5 pontos): o *símbolo* já é
  `CompassMark`, mas o texto ao lado é JSX à mão (`<strong>` + `<em>`), e nem
  entre si os cinco batem — o header escreve `NORTH`, o overlay e o rodapé
  escrevem `north`. É exatamente o problema que `BrandLockup` existe para
  matar. Saída: uma variante `portal` (e uma `portal-compact`, para os 14px)
  em `LOCKUPS`, mantendo as classes `.np-wordmark` / `.np-logo-dot` que o CSS
  do portal já usa.
- **Cartão social (OG)**: `app/opengraph-image.tsx` desenha a palavra `NORTH`
  sem a bússola e com hex literais próprios (`#061619`, `#e8dcc0`, `#9fc9c2`)
  em vez de `app/brand/tokens.ts`. Roda em `next/og` (Satori), fora do React do
  app: não dá para simplesmente montar `<CompassMark />` ali. Saída: embutir a
  bússola como `data:` URI gerado por `compassSvgMarkup`, e trocar os hex por
  `BRAND_COLORS` — ambos os passos precisam ser verificados no Satori antes de
  entrar.

Ao adicionar um lugar novo, use `BrandLockup` se for logo com texto, ou
`CompassMark` se for só o símbolo — e acrescente a linha na tabela acima.
