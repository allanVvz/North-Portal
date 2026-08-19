# Performance orgânica — plano futuro

Status: planejado, não implementado.

## Decisão de navegação

- Manter `Performance > Anúncios` como a tela atual, alimentada apenas por Meta Ads.
- Criar futuramente um botão superior irmão chamado `Orgânico`.
- `Orgânico` será uma réplica estrutural do dashboard de anúncios, com métricas e textos próprios; dados pagos e orgânicos não serão somados.
- Preservar `Cards` como a visão operacional/manual já existente.

## Escopo futuro

1. Conectar Instagram e Facebook orgânicos por uma fonte autorizada e validar permissões/retensão.
2. Normalizar publicações por conta, plataforma, formato e data, preservando permalink e identificador do post.
3. Exibir alcance, impressões, curtidas/reações, comentários, compartilhamentos, salvamentos, visualizações e engajamento.
4. Criar ranking de publicações, mix de interação e tendência diária próprios.
5. Implementar cache separado do datasource `meta_ads` e estados claros para métrica ausente, zero real e erro de coleta.
6. Cobrir com testes unitários e E2E usando contas orgânicas reais mapeadas.

## Fora do escopo desta correção

- Não consultar nem exibir posts orgânicos.
- Não derivar métricas orgânicas a partir de anúncios.
- Não habilitar o botão `Orgânico` antes de a fonte e os testes reais estarem prontos.

## Orgânico + Cards — vínculo de publicação real (2026-08-19)

Status: planejado, não implementado. Roadmap futuro, sem prioridade imediata.

Relacionado: [[AUTOMACOES-IA-HARNESS]] (seção "Agentes de IA planejados" — desenho
completo dos agentes Bia/Copywriter e social media plan que alimentam este fluxo; este
documento só amarra o lado de dados/telas de Performance, não repete o desenho do agente).

- O toggle de nível superior em Performance (`.kb-viewtabs.perf-viewtabs`, hoje usado para
  `Anúncios`/`Cards`) passa a ter 3 abas: **`Anúncios`** (já correto/implementado),
  **`Orgânico`** (escopo já descrito no restante deste arquivo) e **`Cards`** (visão
  operacional já existente, sem mudança de dado).
- **`Orgânico` terá dois provedores de dado**: Meta (orgânico) e **Windsor** — mesmo padrão
  de fonte dupla já usado em Anúncios (`lib/metaInsights.ts` + `lib/windsor.ts`), sem somar
  dado pago com orgânico (regra já registrada acima).
- **`Cards` representa os cards publicados** — cards de criativo movidos para o estado
  "publicado" no fluxo do quadro.
- **Vínculo de publicação real, ponta a ponta**: mover um card de criativo para
  "publicado" deve poder disparar a publicação de fato (ads ou orgânico) na plataforma de
  origem, com suporte para publicar diretamente por essa integração. É esse vínculo que
  passa a alimentar as métricas exibidas nas abas `Cards`/`Orgânico` depois — origem do
  dado rastreada até o card que a gerou (mesmo princípio arquitetural de
  [[AUTOMACOES-IA-HARNESS]]: card de ads com origem de dado rastreada, coluna aditiva, sem
  sistema paralelo).
