# North Portal - Requisitos da Sidebar Full-Screen e Bussola

## Objetivo

Definir o comportamento visual, responsivo e de motion da navegacao principal do North Portal.

A sidebar citada no projeto deve ser tratada como uma experiencia full-screen completa, nao como um painel lateral estreito. Quando aberta, ela ocupa toda a tela, centraliza a bussola e organiza os links abaixo dela.

Na v6, nao deve existir sidebar fixa nas telas base. A navegacao persistente acontece pelo header. A sidebar aparece apenas quando o usuario abre o menu.

## Estrutura de Navegacao

Menus principais no header (reorganizados em 2026-07-06, ver secao "Automacao implementada"):

- Inicio
- Cliente
- Operacao
- North
- Resultados

Submenus:

- Cliente: Jornada, Briefing, Acessos & Pastas
- Operacao: Agenda, Feedbacks, Plano de Acao
- North: Time North, Trilhas North, Documentos, Central Comercial
- Resultados: Dashboard

`Jornada` e `Jornada & Onboarding` sao a mesma tela (so renomeada) — ela centraliza pendencias: documentos pendentes, leituras pendentes, briefing e trilhas obrigatorias (ex. Manual do Cliente, que agora vive em Trilhas North). `Central Comercial` saiu do territorio Cliente e passou para o territorio North (relacao formal com a agencia). `Agenda` e `Plano de Acao` saíram do territorio North/Performance e formaram o novo territorio Operacao junto com Feedbacks (rotina ativa cliente-North).

## Direcoes da Bussola

A bussola e o elemento central da navegacao. Cada direcao representa um destino.

Direcoes principais (cardeais N/L/S/O, exclusivas do `BigCompass` — ver "Automacao implementada"; `Inicio` fica fora desse esquema de 4 letras, tem so o proprio item em O):

- Oeste: Resultados
- Sul: Cliente
- Norte: North (regra obrigatoria: pagina ativa `Time North` -> agulha em 0deg exato)
- Leste: Operacao

Direcoes secundarias (por item, usadas no dropdown/overlay e no `DIR_DEG`):

- Cliente / Jornada: S
- Cliente / Briefing: SSW
- Cliente / Acessos & Pastas: SE
- Operacao / Agenda: E
- Operacao / Feedbacks: NE
- Operacao / Plano de Acao: ESE
- North / Time North: N
- North / Trilhas North: NNE
- North / Documentos: NW
- North / Central Comercial: NNW
- Resultados / Dashboard: W (mesmo grau de "O", deliberadamente distinto de Operacao/E)

O territorio North recebe reforco visual de marca no dropdown e no overlay (borda/accent na cor verde da marca, `.np-dropdown-north` / `.np-ov-col-north`) — é o território "proprietário" da North (time, trilhas, documentos, relação comercial).

## Header Desktop

O header deve conter:

- marca North Portal;
- menus principais;
- dropdowns por grupo;
- botao para abrir a sidebar full-screen;
- estado ativo do menu atual;
- suporte a teclado.

Comportamento dos dropdowns:

- abrir em hover e click;
- manter aberto enquanto o foco estiver no grupo;
- fechar ao pressionar Esc;
- fechar ao clicar fora;
- suportar navegacao por Tab;
- indicar visualmente o item ativo;
- cada submenu deve mostrar sua direcao correspondente na bussola.

## Sidebar Full-Screen

Ao abrir a sidebar:

- ocupar `100vw` e `100dvh`;
- aplicar overlay escuro sobre a tela atual;
- manter conteudo anterior desfocado ao fundo;
- centralizar a bussola na viewport;
- mostrar links principais abaixo da bussola;
- mostrar sublinks contextuais do menu ativo;
- manter botao de fechar visivel;
- ocultar bottom navigation no mobile;
- preservar o estado da pagina atual.

Na Home:

- a bussola deve se adaptar ao estado geral de menu;
- a direcao ativa deve apontar para Inicio;
- os quatro menus principais devem aparecer como opcoes abaixo.

Em telas internas:

- a bussola deve continuar presente;
- a ponta deve apontar para a direcao da pagina atual;
- sublinks do grupo ativo devem ficar visiveis;
- ao clicar em outro destino, a animacao roda antes da troca de pagina.

## Automacao implementada (2026-07-05)

Implementado em `app/[slug]/PortalPaged.tsx` (componentes `Overlay` e `BigCompass`) + `app/[slug]/portal.css`.

**Bug corrigido — bussola sem limite de tamanho:** `.np-bigcompass` nao tinha nenhuma regra de largura/altura, entao o SVG (sem `width`/`height`, so `viewBox`) renderizava no tamanho automatico de bloco (~1485x1485px medido ao vivo), estourando a tela e exigindo scroll interno enorme. Corrigido com `.np-overlay-compass .np-bigcompass { width: min(440px, 74vw); height: auto; }` (mesmo padrao ja usado em `.np-home-compass .np-compass`), com breakpoints 380px/74vw (<=900px) e 320px/84vw (<=560px) — bate com os intervalos do documento (360-440 desktop, 320-380 tablet, 280-340 mobile).

**Bug corrigido — scroll vazando atras do overlay:** `body.np-menu-open { overflow: hidden }` sozinho nao bloqueava scroll por wheel em todos os casos (confirmado ao vivo: `document.body.scrollTop` chegou a mover 444px com o overlay aberto). Trocado por lock via `position: fixed` com o offset de scroll atual congelado em `top`, restaurado com `window.scrollTo` ao fechar — padrao robusto usado por bibliotecas como Radix/Reach UI.

**Agulha segue o ponteiro do mouse:** enquanto o cursor esta sobre o SVG da bussola, `onMouseMove` calcula o angulo do cursor em relacao ao centro do disco (`Math.atan2` ajustado para 0deg=Norte, sentido horario) e a agulha rotaciona em tempo real (transicao curta, 0.05s linear, so para nao "pular" entre frames). O item de navegacao mais proximo daquele angulo (`nearestItem`, distancia circular entre graus) e reportado para exibir titulo+descricao ao vivo. Ao tirar o mouse do disco, a agulha volta a repousar na direcao da pagina atual (`activeDir`).

**Clique trava a agulha na direcao escolhida antes de navegar:** tanto os links das colunas quanto as letras cardeais do disco chamam a mesma funcao `requestGo` (em `Overlay`) — ela trava a agulha no grau exato do destino, anima com easing `cubic-bezier(.22,1,.36,1)` por ~480ms (dentro da faixa 420-560ms already especificada abaixo) e só entao chama a navegacao real (`onGo`). Um `useRef` bloqueia cliques duplicados durante a animacao. Testado ao vivo: clique em "Time North" (dir N) prende a agulha em 0deg com a transicao lenta, e so ~480ms depois o hash muda para `#time-north` e o overlay fecha.

**Correcoes 2026-07-06 (regressao apos a primeira rodada):**
- **Cardeais cortados:** as letras E/O ("L"/"O") e seus sub-rotulos ("PERFORMANCE"/"INÍCIO") ficavam parcialmente fora do `viewBox` de 460 unidades (posicionados a raio 232 num viewBox de meia-largura 230 — sem nenhuma margem, o texto era cortado pelo clip default do SVG). Corrigido reduzindo o raio para 225 E adicionando `overflow: visible` no `.np-bigcompass` (CSS), garantindo que nada seja cortado mesmo que a métrica exata do texto varie por fonte/zoom.
- **Hover em item do menu não movia a agulha:** o hover nos links das colunas (`.np-ov-link`) só atualizava a legenda de titulo/descricao (`hoverItem`), nunca o angulo da agulha em si — só o mouse sobre o proprio disco fazia isso. Corrigido: `Overlay` agora repassa `externalDeg` (grau do `hoverItem`) para `BigCompass`, que usa essa prioridade: `lockDeg > pointerDeg (mouse sobre o disco) > externalDeg (hover em link) > activeDir (parado)`. Testado ao vivo com hover real (nao sintetico) em "Time North": agulha girou para 0deg (Norte) corretamente.
- **Marcador circular no ponto apontado:** novo `<circle>` duplo (anel + ponto), pulsando via `@keyframes npBcPulse` (raio 6→20, opacidade 1→0, 1.1s, reinicia a cada troca de direção via `key={Math.round(deg)}` forçando remount), posicionado exatamente no anel externo (`r=205`) no angulo atual — sinaliza visualmente "este lado tem uma página real". Desabilitado (estado final estatico) sob `prefers-reduced-motion`.

**Reorganizacao dos territorios + Trilhas North (2026-07-06):** os 4 grupos de navegacao viraram Cliente/Operacao/North/Resultados (era Cliente/North/Performance) — ver "Estrutura de Navegacao" acima para o mapa completo. Nova tela `Trilhas North` (`TrilhasPage` em `PortalPaged.tsx`, conteudo estatico em `portalData.ts.trilhas`) e a central educacional da North (slides/videos), com um material "hero" em destaque (Manual do Cliente) + lista completa abaixo (tipo, etapa, ordem, status, CTA). O item "Manual do Cliente" na Jornada agora aponta para `trilhas` (nao mais para `inicio`). Como o `BigCompass` so tem 4 posicoes fixas (N/L/S/O), a tela `Inicio` saiu dessa lista fixa (ficou so nas colunas do overlay e no item do proprio grupo) para abrir espaco para o novo territorio Operacao — os 4 slots agora sao North/Operacao/Cliente/Resultados.

**Titulo e descricao da tela exibidos:** a legenda acima do disco (`.np-overlay-info`) e dinamica — mostra o item sob o mouse (`hoverItem`) quando presente; senao mostra o item da pagina atual (`ALL_ITEMS.find(it => it.page === activePage)`, com fallback pro blurb do cluster ativo quando a pagina não está em `ALL_ITEMS`, ex. "briefing"/"config"); durante a animacao de clique, mostra o item de destino travado.

## Animacao da Bussola

Sequencia ao selecionar um menu ou submenu:

1. Usuario clica no item.
2. Dropdown/sidebar bloqueia clique duplicado temporariamente.
3. A ponta da bussola gira ate a direcao correspondente.
4. O anel da bussola pulsa levemente.
5. A tela atual aplica blur e fade.
6. A rota troca.
7. A nova tela entra com fade e leve movimento vertical.
8. A bussola confirma o estado ativo.

Valores recomendados:

- rotacao da ponta: 420ms a 560ms;
- easing: `cubic-bezier(0.22, 1, 0.36, 1)`;
- pulso do anel: 280ms;
- blur da tela atual: `blur(8px)`;
- fade out: 180ms a 220ms;
- fade in: 240ms a 300ms;
- deslocamento de entrada: 10px a 14px.

Reduced motion:

- se `prefers-reduced-motion` estiver ativo, remover giro longo;
- aplicar apenas estado final da bussola;
- manter fade curto sem blur intenso.

## Responsividade

Desktop:

- header visivel;
- dropdowns horizontais;
- sidebar full-screen ao abrir menu;
- bussola entre 360px e 440px;
- links principais em linha abaixo da bussola.

Tablet:

- header compacto;
- dropdown pode virar painel central;
- sidebar full-screen obrigatoria;
- bussola entre 320px e 380px;
- links principais em grid de duas colunas.

Smartphone:

- header reduzido;
- botao de menu sempre visivel;
- sidebar full-screen obrigatoria;
- bussola centralizada entre 280px e 340px;
- links principais em lista vertical;
- sublinks em accordion/dropdown compativel com toque;
- bottom navigation deve ficar escondida enquanto a sidebar estiver aberta.

## Estados Obrigatorios

- Header default
- Header com dropdown aberto
- Sidebar full-screen aberta na Home
- Sidebar full-screen aberta em pagina interna
- Sidebar full-screen mobile
- Estado de transicao com blur/fade
- Estado reduced motion
- Estado ativo por menu principal
- Estado ativo por submenu

## Acessibilidade

Requisitos:

- foco visivel em menu, dropdown, links e botao de fechar;
- `aria-expanded` no trigger de dropdown;
- `aria-controls` conectando trigger e painel;
- `aria-current=\"page\"` no link ativo;
- fechamento via Esc;
- navegacao completa por teclado;
- contraste suficiente entre texto e fundo;
- labels claros para direcoes da bussola;
- fallback textual para leitores de tela.

## Regras de Implementacao

- Header e sidebar devem consumir a mesma fonte de dados de navegacao.
- A direcao da bussola deve vir do item de navegacao, nao de logica espalhada.
- Cada item deve conter: `label`, `href`, `group`, `direction`, `children`.
- O componente da bussola deve receber `activeDirection`.
- O dropdown deve chamar a animacao antes da navegacao.
- A sidebar full-screen deve ser reutilizada em desktop, tablet e mobile.
- A Home e paginas internas usam o mesmo sistema, mudando apenas o estado ativo.

## Criterio de Pronto

Considerar pronto quando:

- todas as telas tiverem header com menus principais;
- dropdowns estiverem mapeados com direcoes;
- sidebar abrir em tela inteira;
- bussola estiver centralizada em todas as larguras;
- clique em link redirecionar a bussola antes da troca de tela;
- blur, fade e motion estiverem descritos e implementaveis;
- mobile tiver sidebar full-screen e lista de links tocavel;
- reduced motion estiver previsto.
