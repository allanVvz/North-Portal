# Contrato multiagente do relatório de conversão

O relatório é editado em camadas. Nenhum agente recebe o PDF como fonte de
verdade nem pode reinterpretar um número definido por outra camada.

## Fluxo

1. **Evidência determinística** reúne métricas, histórico, campanhas, anúncios,
   objetivos e `optimizationGoal`. Resolve o objetivo na ordem: configuração
   explícita, anúncios, linha de campanha, `objective`, nome.
2. **NorthAI** recebe somente os fatos estruturados. Produz claims tipadas
   (`fact`, `comparison`, `context`, `limitation`) e referencia as comparações
   já calculadas; não calcula nem atribui causalidade.
3. **Dashboard Architect** recebe as evidências e o handoff validado do
   NorthAI. Decide hierarquia, ordem e densidade, sem coordenadas livres.
4. **Renderer determinístico** impõe tipografia, limites de texto, geometria
   dos criativos, paginação e métricas próprias de cada objetivo.
5. **Visual QA** lê o PDF renderizado localmente e reporta violações por
   página/seção. O reparo altera somente os nós afetados e renderiza novamente.

## Invariantes

- `PROFILE_VISIT` nunca pode ser rotulado como clique para site.
- Campanhas de perfil, site e mensagens mantêm resultado e custo próprios.
- Todo `adId` relevante aparece uma vez na tabela completa; destaques são um
  subconjunto e nunca substituem a tabela.
- O ganho positivo abre a narrativa. Uma comparação desfavorável permanece
  visível, mas não ocupa o lugar do resultado principal.
- A tabela `Crescimento de audiência` fica no bloco final, junto do histórico.
- O mesmo fato não deve ser repetido em hero, narrativa e bullets. A narrativa
  interpreta; tabelas preservam os números exatos.
- Título, cabeçalho e primeira linha de uma tabela não podem ser separados por
  quebra de página.
- PDF, imagem, URL de arquivo, credencial e identidade do cliente não entram no
  prompt de planejamento.

## Gates de aceitação

- quatro formatos de destaque (1, 2, 3 e 4) sem colisão;
- todos os anúncios presentes na tabela detalhada;
- nenhum texto de site quando só há evidência de perfil;
- resultado e custo coerentes com o objetivo resolvido;
- fallback determinístico com `aiUsed=false` para modelo ausente ou resposta
  inválida;
- comentário automático substituído de forma idempotente;
- inspeção das duas primeiras páginas após qualquer mudança de composição.

