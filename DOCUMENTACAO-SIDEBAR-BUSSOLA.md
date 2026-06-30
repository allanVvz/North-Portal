# North Portal - Requisitos da Sidebar Full-Screen e Bussola

## Objetivo

Definir o comportamento visual, responsivo e de motion da navegacao principal do North Portal.

A sidebar citada no projeto deve ser tratada como uma experiencia full-screen completa, nao como um painel lateral estreito. Quando aberta, ela ocupa toda a tela, centraliza a bussola e organiza os links abaixo dela.

Na v6, nao deve existir sidebar fixa nas telas base. A navegacao persistente acontece pelo header. A sidebar aparece apenas quando o usuario abre o menu.

## Estrutura de Navegacao

Menus principais no header:

- Inicio
- Cliente
- North
- Performance

Submenus:

- Cliente: Jornada & Onboarding, Central Comercial, Acessos & Pastas
- North: Feedbacks, Time North, Documentos, Agenda
- Performance: Dashboard, Plano de Acao

## Direcoes da Bussola

A bussola e o elemento central da navegacao. Cada direcao representa um destino.

Direcoes principais:

- Oeste: Inicio
- Sul: Cliente
- Norte: North
- Leste: Performance

Direcoes secundarias:

- Cliente / Jornada & Onboarding: SSW
- Cliente / Central Comercial: S
- Cliente / Acessos & Pastas: SSE
- North / Feedbacks: NE
- North / Time North: N
- North / Documentos: NNE
- North / Agenda: NW
- Performance / Dashboard: E
- Performance / Plano de Acao: ESE

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
