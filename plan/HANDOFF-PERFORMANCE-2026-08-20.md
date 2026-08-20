# Handoff · Performance · 2026-08-20

## Estado final

- Branch: `main`.
- Produção: `https://north-portal-navy.vercel.app/admin/performance`.
- Último commit funcional: `b734b87` (`feat(performance): add acquisition conversion dashboard`).
- Vercel: deployment de produção `READY`; smoke Playwright em produção passou.
- Worktree estava limpo ao concluir a implementação.

## Commits desta entrega

- `4668496` — templates de equipe, hierarquia Campanha/Conjunto/Criativo e comparação por linhas.
- `0773e13` — lockfile sincronizado para o `npm ci` do CI.
- `b734b87` — nova aba Aquisição, funil/ponte consolidados e asset 3D transparente.

## Banco e migrations

- `supabase/migrations/20260820000001_performance_templates.sql` cria a persistência de templates.
- A migration já foi aplicada no Supabase de produção.
- A aba Aquisição reutiliza os endpoints Meta existentes e não exige migration adicional.

## Analytics

- Header com campo de período separado e uma caixa composta para Template, Cliente, Categoria, Rede e Objetivo.
- Templates novos são compartilhados com toda a equipe (`agency`).
- Cliente é contexto de consulta e não entra no template; os demais filtros, período, KPIs, formatos, métricas customizadas, fontes Pago/Orgânico, colunas, ordenação e seleções entram.
- Alterar qualquer configuração do template, exceto Cliente, acende o botão circular Salvar.
- Atualizar é circular, sem texto; limpar seleção é um `×` vermelho sem contorno com contador.
- Seleções por checkbox comparam campanhas, conjuntos ou criativos no gráfico de tendência. Séries coincidentes continuam distinguíveis por traço e cor.
- Recharts usa explicitamente Inter nos eixos, tooltip e legenda.

## Aquisição

- Terceira aba de Performance, ao lado de Analytics e Cards publicados.
- Header no mesmo padrão do Analytics: `DateRangeField` separado e uma caixa composta Campanha/Conjunto com busca, chips e multisseleção.
- KPIs: Investimento, Oportunidades e Custo por lead.
- Indicadores: Impressões, Cliques e Taxa de conversão.
- Gráfico: Investimento × Mensagens iniciadas, com eixos independentes.
- Eficiência: gauges CPM, CPC e CTR comparados ao período anterior, sem benchmark inventado.
- Card central consolidado: funil Alcance → Cliques → Leads → CPA; Mensagens são uma ramificação paralela dos cliques, nunca uma etapa depois de Leads.
- A taxa Clique → Mensagem prioriza `cliquesLink`; usa `cliques` apenas como fallback explicitamente rotulado.
- Tabela de criativos: Criativo, Cliques, Leads, CPA e CTR.
- Asset: `public/images/performance/acquisition-funnel.png`, PNG ARGB transparente, invertido por CSS para leitura largo → estreito.

## Semântica e limites analíticos

- Oportunidades significa `leads` reportados pela Meta; ainda não há uma fonte CRM de oportunidades no repositório.
- Métrica ausente é `null` e aparece como `—`; zero só aparece quando veio como zero da fonte.
- Divisão por zero nunca produz `NaN`, `Infinity` ou zero artificial.
- Alcance vindo da série diária é somado e rotulado como `diário acumulado`; não equivale a pessoas únicas no período.
- Para alcance único executivo, criar futuramente uma consulta Meta agregada do período, sem `time_increment=1`.
- O detalhamento de várias campanhas usa `Promise.allSettled`; falha parcial preserva os resultados válidos.

## Validação concluída

- `npx tsc --noEmit`: passou.
- `npm test`: 27 arquivos, 259 testes passaram.
- `npm run build`: passou.
- E2E Analytics: templates e comparação em Campanha/Conjunto/Criativo passaram.
- E2E Aquisição: 2/2 passaram localmente e 2/2 passaram em produção.
- Desktop e mobile: sem overflow; console e `pageerror` zerados.
- CI remoto: passou.
- Vercel Runtime Errors nas rotas de Performance: nenhum erro na janela pós-deploy.

## Evidências e documentação relacionada

- `plan/PERFORMANCE-CUSTOMIZACAO.md`
- `plan/PERFORMANCE-TEMPLATES-HIERARQUIA.md`
- `plan/PERFORMANCE-AQUISICAO.md`
- Screenshots locais ignoradas pelo Git: `.codex-run/performance-acquisition-desktop.png` e `.codex-run/performance-acquisition-mobile.png`.

## Gotchas locais

- O `next dev` degrada após muitas recompilações. Quando houver timeout sem causa de produto: encerrar somente os processos Node deste repo, validar que `.next` está dentro do workspace, remover `.next` e reiniciar com stdout em `devserver.log`.
- Neste Windows, usar `NODE_USE_SYSTEM_CA=1` no processo do Next/Playwright para evitar `fetch failed` na validação de sessão Supabase.
- Não persistir credenciais E2E em arquivos; fornecê-las apenas por variável de ambiente no processo.

## Débitos que permanecem fora desta entrega

- Revisar ponta a ponta quando Aprovação/Revisão é bloqueante por cliente; `e2e/client-approval-flow.spec.ts` continua pausado por decisão de produto.
- Adicionar coleta agregada de alcance único para relatórios executivos.
- Se a configuração da aba Aquisição também precisar virar parte dos templates de Analytics, elevar o estado comum para `PerformanceScreen` ou um provider; hoje os filtros da Aquisição são de sessão.
