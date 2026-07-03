# Plano — Concluir todas as pendências no Figma

> **Arquivo prod:** `I1nVg0mJH169Mv7IdVC67M` (Plataforma-North-prod) · **Data:** 2026-07-02
> **Fonte da verdade do estado:** `docs/CURRENT_STATE_FIGMA_NORTH_ADMIN.md` (sessões 12–17).
> **Objetivo:** fechar o backlog de design/protótipo herdado das sessões 9–17, deixando as **6 páginas Prod** (3 sources + 3 L↔D) consistentes, com ícones corretos, protótipo funcional e dark-mode validado.

Cada fase tem: **o quê · onde (node ids) · técnica · critério de aceite**. As convenções (paleta, darkify, glass, gotchas do `use_figma`) estão no handoff §2–§3 e devem ser reusadas. Ordem sugerida = por dependência e por relação esforço/impacto.

---

## Backlog consolidado (o que ainda está pendente)

| # | Pendência | Origem | Página(s) |
|---|---|---|---|
| P1 | Ícones de **tipo de tarefa** (Criativo/Agendamento/Desempenho) descentralizados; **calendário** não parece calendário; **desempenho** não parece gráfico crescendo | Deferido S13 | Admin `295:2` + `365:2` |
| P2 | Ícone **⚙ Configurações** errado → trocar por vetor de **engrenagem** no component set `Sidebar/Admin` (`481:662`, glifos `481:48`/`481:103`) e propagar | Deferido S13 | todas sidebars admin |
| P3 | **Admin L↔D `365:2` desatualizado** vs sources (modais Criativo/Agendamento corrigidos na S11, ícones novos) → re-sync mirror+darkify+toggles+BFS | Deferido S13 / S11 | `365:2` |
| P4 | **Menu Bússola legado** (`434:2` claro / `306:2` escuro — este **não existe mais**) coexiste com as 2 versões novas (Hold `2164:2` / Natural `2167:2`). Definir retirada do legado e menu escuro próprio | S17 | Cliente `269:2` + `365:3` |
| P5 | **Rodapé creme em dark** (Planos/Como funciona) — darkify não escureceu o footer | Deferido S13 | Landing `365:4` |
| P6 | **Header cliente como componente** (`Cliente/Header`, variantes Theme=Light/Dark) + passe de fonte "alterar em todos" | Deferido S14 | Cliente (todas) |
| P7 | **Links cross-page** (footer legal Cliente/Admin → Política/Termos que vivem no Landing) não navegam — limitação Figma | Limitação S12 | `365:3`, `365:2` |
| P8 | **Validação completa das 6 páginas Prod** (não só as 3 L↔D): travessia BFS + dark-mode frame-a-frame + destinos reais de sidebar/header | Pendências S11 | 6 páginas |
| P9 | **Gatilhos de modal por tipo** usam heurística de chip; revisar cards sem chip | Observação S12 | Admin |
| P10 | **Heranças novas não espelhadas** conscientemente (Manual web, Guia de Stories) — confirmar que ficam como sections editoriais e não como pares L↔D | S16/S17 | Cliente |

---

## Fase 0 — Auditoria de estado (antes de editar)
**Objetivo:** confirmar o estado real (o handoff pode estar desatualizado) e gerar a lista exata de nós a corrigir.

- **Tarefas**
  1. Confirmar Figma MCP ativo (`whoami`).
  2. Rodar script read-only por página (`295:2`, `365:2`, `269:2`, `365:3`, `288:2`, `365:4`): listar frames top-level (id, nome, x/y/w/h) + detectar **sobreposições** (AABB) e **frames órfãos**.
  3. Rodar **BFS de travessia** nas 3 páginas L↔D (reusar script da S16): `invalid`, `noOutbound`, `reachesAll`.
  4. Auditar ícones: localizar os glifos de tipo/engrenagem (`481:48`/`481:103` e ícones nos cards de tarefa) e capturar screenshots.
  5. Diff Admin source × Admin L↔D: comparar os frames de `295:2` com seus clones em `365:2` (por nome) e marcar os desatualizados.
- **Critério de aceite:** relatório com (a) overlaps por página, (b) resultado BFS atual, (c) lista de nós de ícone a trocar, (d) lista de pares Admin L↔D stale.

---

## Fase 1 — Ícones (P1, P2) · *rápido, alta visibilidade*
**Objetivo:** ícones corretos e centralizados, propagados via componente.

- **P2 Engrenagem:** editar o glifo `⚙` no component set `Sidebar/Admin` (`481:662`, nós `481:48`/`481:103`) por um **vetor de engrenagem** (createVector: círculo + 8 dentes + furo central) centralizado no frame do ícone. Como todas as sidebars usam **instâncias**, editar o master propaga. Verificar telas que usam "Frame" genérico (admin antigos) e trocar lá também.
- **P1 Ícones de tipo:** nos cards de tarefa (Quadro/Tabela/Detalhe/Calendário e modais):
  - **Criativo** → ícone de imagem/play (retângulo + triângulo play) centralizado.
  - **Agendamento/Calendário** → **grade de calendário** (retângulo + cabeçalho + linhas + dia marcado).
  - **Desempenho** → **gráfico crescendo** (eixo + barras/linha ascendente + seta).
  - Centralizar via auto-layout `CENTER/CENTER` no chip do ícone (44×44).
- **Técnica:** editar sources primeiro (`295:2`) → re-clonar/instância propaga; depois refletir no `365:2` (Fase 3).
- **Critério de aceite:** screenshots dos 3 tipos + engrenagem centralizados; nenhuma sidebar com `⚙` textual antigo.

---

## Fase 2 — Menu Bússola: consolidar (P4)
**Objetivo:** eliminar ambiguidade entre menu legado e as 2 versões novas.

- **Decisão a tomar (ver Dúvidas):** as versões novas **Hold `2164:2`** e **Natural `2167:2`** viram o padrão operacional. O legado `434:2` (claro) pode ser **arquivado** (mover para área "legado" fora da grade) e o `306:2` (escuro, já inexistente) descartado.
- **Tarefas**
  1. Repointar **todas** as referências de `434:2`/`306:2` → `2167:2` (Natural) na `269:2` e no `365:3` (já feito parte na S17; varrer o restante).
  2. Menu escuro próprio: hoje o dark do menu no L↔D é darkify do claro. Se quiser um menu escuro "artesanal" (petróleo com linhas da bússola específicas), construir e substituir o par dark. Senão, manter darkify (aceitável).
  3. Mover `434:2` para uma faixa "· legado ·" na `269:2` (fora da grade operacional) para não confundir.
- **Critério de aceite:** 0 referências a `434:2`/`306:2` nos fluxos operacionais; menu novo alcançável de todas as telas cliente (botão bússola + compass).

---

## Fase 3 — Re-sincronizar Admin L↔D `365:2` (P3, P1/P2 refletidos)
**Objetivo:** o Admin L↔D refletir os sources atuais (modais corrigidos S11 + ícones Fase 1).

- **Técnica (mesma da S16 para o Cliente):**
  1. Deletar pares desatualizados (lista da Fase 0) ou **regenerar a página do zero** a partir de `295:2` (sources: `295:3, 297:2, 299:2, 299:133, 323:2, 311:2, 336:15, 358:2, 358:72, 358:142, 374:2, 375:2, 375:65` + modais `454:*` — **NÃO** incluir `252:2`).
  2. Coluna clara = clone; coluna escura = **darkify type-aware** (mapa §2). Cuidar do bug de `clone()` que zera `destinationId` → **strip + rewire** (toggles + cadeia `PrototypeNext` + wiring real de sidebar/modais), como na S16.
  3. Corrigir contraste de **títulos com fills mistos** via `getStyledTextSegments`/`setRangeFills`.
- **Critério de aceite:** BFS `365:2` PASS (`invalid=0`, `noOutbound=0`, `reachesAll`); screenshots dos modais (Criativo/Agendamento/Desempenho/Nova Tarefa/Documento/Config Atributos) claro+escuro corretos; ícones novos presentes.

---

## Fase 4 — Consistência de header/footer (P5, P6)
- **P5 Rodapé dark (Landing `365:4`):** escurecer os footers creme dos dark frames (Planos/Como funciona). Passe: para cada dark frame, se o footer ainda estiver em cor clara (`cream/band`), aplicar o mapa cream→dark **apenas em superfícies** (não em TEXT) + recolorir texto do footer para muted/cream legível.
- **P6 Header como componente:** transformar o header cliente em **componente `Cliente/Header` (variantes Theme=Light/Dark)**; trocar as instâncias nas 11 telas cliente. Rodar o passe de fonte (wordmark Inter Extra Bold; nav Inter Medium) no master → propaga. *(Item de robustez; pode ficar por último.)*
- **Critério de aceite:** nenhum footer claro em tela dark no `365:4`; headers cliente idênticos (checar por screenshot 2–3 telas claro/escuro).

---

## Fase 5 — Navegação cross-page (P7) · *workaround da limitação*
**Contexto:** o Figma rejeita `NAVIGATE` entre páginas. Links de Política/Termos no rodapé de Cliente/Admin não funcionam porque essas telas vivem no Landing.

- **Opções (escolher):**
  - (a) **Copiar** os frames Política (`294:2`) e Termos (`294:83`) para dentro de `365:3`/`365:2` como destinos locais (mais nós, mas navegação real).
  - (b) Aceitar a limitação e **documentar** (não bloqueia travessia).
- **Recomendação:** (a) só se a demo precisar clicar nesses links dentro do fluxo cliente/admin; senão (b).
- **Critério de aceite:** decisão registrada; se (a), links do rodapé navegam.

---

## Fase 6 — Validação completa das 6 páginas Prod (P8, P9, P10)
**Objetivo:** fechar o protótipo inteiro, não só as 3 L↔D.

- **Tarefas**
  1. **Destinos reais de navegação** para todos os itens de sidebar (Admin) e header/nav (Cliente/Landing) — nas SOURCES e nos L↔D. `PrototypeIndex/Next` continua só como trilha de auditoria.
  2. **BFS PASS** nas 3 L↔D + varredura de `invalid=0` também nas 3 sources (onde fizer sentido).
  3. **Dark-mode frame-a-frame:** screenshot de cada par escuro procurando texto escuro-sobre-escuro (rerodar o teste de luminância `L<0.30` da S13) → 0 ocorrências.
  4. **P9:** revisar cards de tarefa sem chip de tipo (gatilho de modal cai no default) → garantir destino correto por tipo.
  5. **P10:** confirmar que Manual (`2123:2`) e Guia de Stories (`2170:2`) permanecem como **sections editoriais** navegáveis por deck (não como pares L↔D) — documentar a decisão.
- **Critério de aceite:** tabela de travessia PASS nas 3 L↔D; 0 texto escuro-sobre-escuro; todos os itens de nav com destino; decisão P10 registrada.

---

## Convenções e portões de qualidade (aplicar em todas as fases)
- **Editar sempre o SOURCE primeiro**, depois propagar ao L↔D (clone claro + darkify escuro).
- **Darkify type-aware** (mapa §2): `cream→dark` **não** em nós TEXT; corrigir fills mistos por segmento.
- **Reactions:** `actions` plural, `transition:null`, try/catch, **cross-page proibido**, self-nav proibido; `clone()` zera destinos → sempre re-wire.
- **Validar por `get_screenshot` a cada etapa** e por script BFS ao fim de cada fase.
- **Atualizar** `docs/CURRENT_STATE_FIGMA_NORTH_ADMIN.md` e a memória ao final.

## Sequência recomendada (esforço → impacto)
1. **Fase 0** (auditoria) — barato, destrava o resto.
2. **Fase 1** (ícones) — rápido, muito visível.
3. **Fase 2** (menu bússola) — remove ambiguidade.
4. **Fase 3** (Admin L↔D re-sync) — maior esforço; usa Fase 1.
5. **Fase 4** (header/footer) — polimento.
6. **Fase 6** (validação total) — porta de saída.
7. **Fase 5** (cross-page) — opcional conforme demo.

## Decisões que preciso do usuário antes de executar
1. **Menu legado `434:2`:** arquivar/retirar da grade operacional? (recomendo sim)
2. **Admin L↔D:** regenerar do zero (mais limpo) ou substituir só os pares stale? (recomendo regenerar)
3. **Links cross-page (P7):** copiar Política/Termos para dentro de Cliente/Admin (a) ou aceitar limitação (b)?
4. **Header componente (P6):** fazer agora ou deixar como último polimento?

## Riscos / limitações conhecidas
- **Cross-page NAVIGATE** é limitação dura do Figma (P7).
- **Regenerar L↔D** reintroduz o bug de `clone()` (destinos null) → mitigado pelo passe de strip+rewire.
- **Rotação de agulha/ícones** por grupo desloca o nó → preferir redesenhar via `createVector` (lição S17).
