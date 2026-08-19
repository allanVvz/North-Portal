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
