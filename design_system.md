# North Portal — Design System

> Fonte da verdade do design. Estética **v4 validada**: editorial, sofisticada, petróleo + sand/cream + sage-teal, tipografia Fraunces (serif) + Inter. **Glassmorphism é pilar de marca.** Tema **claro é o principal**; o **escuro** (a própria v4) fica preparado.
> Implementação no Figma **`Plataforma North · prod`** (fileKey **`I1nVg0mJH169Mv7IdVC67M`**). O arquivo antigo `dqw8Ddrdfi6D8xjdkWwVo8` está DESATUALIZADO — não usar. Páginas atuais do protótipo: **Público/Login** `288:2` (login `288:3`), **Cliente (Bússola)** `269:2`, **Admin (Operacional)** `295:2` (Clientes `295:3`, Cadastro `297:2`); espelhos L↔D `365:2` (Admin) · `365:3` (Cliente) · `365:4` (Landing). **O tema CLARO "Névoa Sage" é o principal** (o front local ainda em petróleo escuro é a versão legada a ser migrada).

---

## 1. Essência da marca
- **Bússola** como metáfora central de navegação (Norte = a North; a agulha "segue você").
- Editorial e calmo: muito respiro, microtipografia em caixa-alta espaçada, watermarks de letras cardeais (N·L·S·O).
- Quente e premium (sand/cream/petróleo), nunca um SaaS genérico frio.
- **Duas experiências distintas:** Admin North (operacional, com Kanban) × Cliente (editorial com bússola, **sem Kanban** — vê apenas seus próprios cards/estado).

## 2. Tokens de cor (coleção Figma `North/Color`, modos Light/Dark)

### Tema Claro (principal — **Névoa Sage**, porcelana fria)
> O cream `#E8DCC0` foi **rebaixado**: era bom como *quebra de página*, não como canvas. O canvas agora é a **Névoa Sage** (porcelana fria com subtom sage-grey) — moderna, calma, premium, nada amarelada. Cream = só **faixa/hero accent**. O **glass** eleva o premium (nav, hero, modais, hub).

| Token | Hex | Uso |
|---|---|---|
| bg/base | `#EEF1ED` | fundo do app (névoa sage) |
| bg/surface | `#FBFCFA` | cards (quase-branco) |
| bg/surface-2 | `#E7EAE5` | painéis sutis / pills neutros |
| bg/inset | `#E4E8E2` | inputs / tracks |
| bg/hover | `#E9ECE7` | hover |
| border/subtle · default · strong | `#DEE3DD` · `#D7DDD6` · `#C2CAC2` | hairlines / bordas / anéis |
| text/primary (ink) | `#0C2C2C` | texto principal |
| text/secondary | `#46584F` | texto secundário |
| text/muted | `#7C8A82` | labels / captions |
| text/inverse | `#F4F6F2` | texto sobre acentos escuros |
| accent/teal · strong · text · soft | `#5E9C93` · `#4A857C` · `#336E64` · `#DCEAE4` | ação (botões/dots/pills) |
| **band/cream** · cream-soft · cream-text | `#E8DCC0` · `#F1EAD8` · `#8A6E36` | **faixa/hero de quebra** + acento quente |
| status success·warning·danger·info·neutral | `#3E916B` · `#C99A3E` · `#C2604E` · `#4F7E8E` · `#8A958C` | estados |
| **glass/light** | branco 55–65 % + Background Blur | camada premium |

### Tema Escuro (mais azul-esverdeado, base 148-2)
| Token | Hex |
|---|---|
| bg/base | `#0A2428` |
| bg/surface | `#0E2E32` |
| bg/surface-2 | `#123438` |
| bg/inset | `#081E22` |
| band/cream (faixa) | `#163034` |
| border/subtle · default · strong | `#1C3C3C` · `#274A48` · `#3A5C58` |
| text/primary | `#E8DCC0` (cream) |
| text/secondary | `#9CB4B4` |
| text/muted (eyebrow) | `#7AA9A3` |
| ink (texto em cards cream) | `#0C2C2C` |
| accent/teal · bright · deep | `#78ACA8` · `#93C2B8` · `#5E9C93` |
| sand · cream/card | `#DCD0B4` · `#E8DCC0` |
| status success·warning·danger·info | `#6FBF92` · `#DCB45E` · `#D98A78` · `#8FB0CE` |

> Páginas de briefing e legais usam **cards cream `#E8DCC0`** sobre fundo petróleo (igual v4).

## 3. Glassmorphism — Liquid Glass (pilar de marca)
Padrão de alto nível (referência liquid glass Apple): **transparência alta + blur alto + refração alta + luz**.
- **fill:** gradiente branco vertical 0.6→0.4 (claro) / petróleo 0.24 (escuro) — o gradiente cria a **luz no topo** (sheen). **Background Blur 36–44 px** (alto).
- **border refrativa:** stroke em **gradiente multicor** (branco → teal → sand → teal/deep) em alta opacidade nas arestas — simula refração das cores do fundo.
- **luz:** `INNER_SHADOW` branco 0.6 (linha de brilho interna no topo) + **glow** drop-shadow colorido (teal/sand) atrás das arestas.
- **fundo iluminado, não chamativo:** base + 1 luz radial branca suave + blooms de cor (teal/sand/bright) **bem desfocados e de baixa opacidade**; o background-blur do card os frosta → o vidro "refrata" o fundo.
- **Onde:** login, **Planos** (cards liquid glass de altura igual, botões dentro do enquadramento), hero/landing, header sticky, modais, hub da bússola, dropdown.
- **Interação "hold para ampliar":** `ON_PRESS` (segurar) → **Smart Animate** para um estado com a caixa maior + glow reforçado; ao soltar, retorna. (Implementado nos cards de Planos.)

## 4. Tipografia
- **Fraunces** (serif) — hero e títulos editoriais; mistura roman + **itálico de acento** (palavra em teal). Ex.: "O briefing molda a *estratégia*".
- **Inter** — corpo, labels, microtipografia. Wordmark "north" em Inter pesado, caixa-baixa.
- Escala: Display 40–64 · H1 32 · H2 24 · H3 18 · Body 15 · Small 13 · Caption/eyebrow 11–12 (tracking 1.5–2, caixa-alta).

## 5. Espaçamento & raios
- Base **4 px**; passos 4·8·12·16·24·32·48.
- Raios: sm 8 · md 12 · lg 16 · xl 18 · full 999.

## 6. Componentes
Botões (Solid/Outline/Ghost), Inputs, Pills de status/prioridade, Tags, Avatares, Cards (claro/cream), KPI card, **Kanban card** (só Admin), Table row, Sidebar (Admin), Header editorial (Cliente), e **Bússola**.

### Bússola (espec. — espelha v4 `148:3`)
- 2–3 anéis concêntricos, stroke finíssimo (border/strong @ ~30 %).
- Pontos cardeais pequenos (teal) + letras `N L S O` (Inter, muted).
- Agulha **slim bicolor**: metade superior **sand**, inferior **teal/deep**; ponto central minúsculo.
- Watermark gigante da letra cardinal (Fraunces, baixa opacidade) nas telas internas.
- Caption: `ESCOLHA UMA DIREÇÃO` + "*A agulha segue você*" (Fraunces itálico).
- Pill segmentada dos 4 destinos.

## 7. Arquitetura de navegação
- **Direções:** Norte = **North** · Sul = **Cliente** · Leste = **Performance** · Oeste = **Início**.
- **Cliente (editorial, sem Kanban):** Início · Jornada & Onboarding (Briefing) · Central Comercial · Acessos & Pastas · Feedbacks · Time North · Documentos · Agenda · Dashboard · Plano de Ação. + deck Manual (Checklist, Como funciona, Cronograma, Recomendações, Deveres), Marca & Produtos/Pastas, Resultados/Métricas.
- **Admin North (sidebar operacional):** Kanban Operacional · Clientes · Cadastro de cliente · Aprovações · Onboarding · Documentos · Performance · Plano de Ação · Configurações (+ políticas).
- **Público/Auth:** Landing (simples) · Login (liquid glass) · Política de Privacidade · Termos de Uso · Política de Cookies.

## 8. Regra de visibilidade Admin × Cliente
O Kanban é a fonte da operação no **Admin**. O **Cliente nunca vê o board** — apenas os cards liberados (`clientVisible`) e seu estado, refletidos nas páginas editoriais (ex.: card de criativo aguardando → aparece em Feedbacks; card de plano → Plano de Ação).

## 9. Páginas no Figma (atual — arquivo prod `I1nVg0mJH169Mv7IdVC67M`)
- **Público/Auth** `288:2` — Login liquid glass `288:3`, Landing `293:2`, Políticas/Termos.
- **Cliente (Bússola)** `269:2` — Home/bússola `269:3`, Briefing `270:2`, Manual (deck), Central Comercial, Acessos & Pastas, Feedbacks, Documentos, Agenda, Time North, Plano de Ação, Dashboard.
- **Admin (Operacional)** `295:2` — Clientes `295:3`, Cadastro `297:2`, Tarefas/Kanban (`358:2` Quadro · `358:72` Tabela · `358:142` Detalhe · `374:2` Calendário + modais `462:189/263/337/411`), Aprovações `299:2`, Documentos `311:2`, Configurações `299:133`/`323:2`.
- **Espelhos L↔D:** Admin `365:2` · Cliente `365:3` · Landing `365:4`.
