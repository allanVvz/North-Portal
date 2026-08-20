# Performance · Aquisição

## Objetivo

Conectar a leitura de mídia (CPM, CPC, CTR, impressões e cliques) à leitura comercial (leads, custo por lead e conversas) sem apresentar ausência de sinal como zero.

## Entrega

- Nova aba `Aquisição` em Performance.
- Campo único de período com dois calendários e presets nativos do portal.
- Filtros hierárquicos, pesquisáveis e multisseleção por checkbox para campanha e conjunto de anúncios. As chaves combinam conta, campanha e conjunto para não misturar IDs de contas diferentes.
- Fan-out dos detalhes Meta com `Promise.allSettled`: uma campanha indisponível não derruba as demais.
- KPIs principais: investimento, oportunidades (leads) e custo por lead.
- Leitura lateral: impressões, cliques e conversão de clique para lead.
- Série temporal de investimento e mensagens iniciadas, com eixos independentes e tipografia Inter.
- CPM, CPC e CTR comparados apenas ao período anterior. Os arcos não usam benchmark inventado.
- Funil Alcance → Cliques → Leads, seguido de CPA. Alcance é explicitamente rotulado como diário acumulado.
- Bloco Clique → Mensagem com o objeto roxo recortado no centro.
- Tabela de criativos com cliques, leads, CPA e CTR, carregada sob demanda pela campanha.

## Semântica dos dados

- Métrica ausente é `null` e aparece como `—`; zero só aparece quando veio como zero da fonte.
- Divisão por zero ou por métrica ausente retorna `—`, nunca `Infinity`, `NaN` ou zero artificial.
- Oportunidade significa `lead` reportado pela Meta; mensagens permanecem uma etapa intermediária separada.
- Alcance agregado soma o alcance diário retornado pela fonte. Ele não representa pessoas únicas no período inteiro.

## Verificação

- Unitários em `acquisitionInsights.test.ts` cobrem ausência, divisão por zero, agregação, série temporal e criativos.
- E2E em `performance-acquisition.spec.ts` cobre navegação, composição dos filtros, campo de período, funil, gauges, asset e estado sem campanha.
