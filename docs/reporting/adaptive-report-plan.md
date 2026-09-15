# Plano — relatórios adaptativos (geração 3)

Data: 2026-09-15. Baseado em `docs/audits/report-storytelling-review.md`.
**Planejamento apenas — nada implementado.**

Princípio: **dados completos + leitura simples + hierarquia que muda com o dado**.
Relatório pequeno quando a semana é pequena; grande quando há o que mostrar. O dado não se
adapta ao template; o template se adapta ao dado.

Leitura em três olhares:
1. **primeiro olhar** — figura principal + manchete: entendo o resultado;
2. **segundo olhar** — funil + 2–4 análises: entendo por quê;
3. **terceiro olhar** — tabelas de objetivos, criativos, vendas: consigo investigar.

---

## 1. Arquitetura final — Relatório 1 (Anúncios)

```
A. ABERTURA
   eyebrow cliente · título · período · comparado com
   MANCHETE (1 frase, resultado → contexto)
   FAIXA DE KPIs  investimento · alcance · impressões · cliques · CTR* · resultado · custo/resultado
   [ALERTA — no máximo 1, só se elegível]

B. FUNIL (sempre)                         C1. ANÁLISES (2–4 frases)
   trapézios proporcionais                    concentração · eficiência · criativo · oportunidade
   taxas entre etapas da própria mídia

C. COMPARAÇÃO ENTRE OBJETIVOS (se ≥2)
   C2. barra pareada: parte da verba × parte do resultado
   C3. TABELA COMPARATIVA com linhas alinhadas

D. CRIATIVOS
   D1. destaques com preview (1–4)
   D2. tabela completa (todos os relevantes)

E. TENDÊNCIA (se ≥3 semanas)
   pequenos múltiplos: investimento · resultado · custo por resultado

rodapé: 1 nota metodológica, se necessária
```

`*` CTR entra na faixa **com explicação curta** só quando o resultado principal da conta é
clique (tráfego para site). Nas demais contas, fica na tabela.

## 2. Arquitetura final — Relatório 2 (Resultados)

Escolha do modo: `focusOf` (existente) + combinações. A **ordem das seções muda por modo**
(§5); os blocos disponíveis são:

```
A. ABERTURA — figura principal da conversão + manchete
B. APOIO — 2–4 figuras secundárias da mesma jornada
C. FUNIL COMPLETO (sempre)
D. ANÁLISES (2–4)
E. HISTÓRICO (comparação simples com 2 semanas; gráfico com 3+)
F. EFICIÊNCIA COMERCIAL (vendas)
G. ORIGEM (vendas segmentadas)
H. CRESCIMENTO DE AUDIÊNCIA (seguidores)
I. VENDAS DESCRITAS (se houver linhas)
J. MÍDIA RESUMIDA — tabela compacta por objetivo
K. CRIATIVO QUE EXPLICA O RESULTADO (1–2, com preview)
rodapé: "Resultados comerciais podem incluir canais além da mídia paga." (quando houver resultado comercial)
```

## 3. Modos do Relatório 2

### 3.1 followers_only — crescimento de audiência

```
+37 seguidores na semana                         ← figura principal (30 pt)
O perfil passou de 1.214 para 1.251 e cresceu 3,05%.

┌ 1.251 no perfil ┐ ┌ 562 visitas ao perfil ┐ ┌ R$ 0,17 por visita ┐ ┌ R$ 96,01 investidos ┐

FUNIL                                  ANÁLISES
ALCANCE        12.569                  "Mesmo com alcance 17% menor, as visitas ao perfil
VISITAS AO PERFIL 562                   ficaram próximas da semana anterior."
SEGUIDORES NOVOS  +37                  "Adconheça a Baita foi o anúncio que mais levou
TOTAL DO PERFIL  1.251 (base)           gente ao perfil."

EVOLUÇÃO DO PERFIL
2 semanas: 1.214 → 1.251 (+37)
3+ semanas: linha do total, rótulo nas pontas; colunas finas do ganho semanal abaixo

CRIATIVO QUE MAIS LEVOU AO PERFIL      [preview] Adconheça a Baita · 90 cliques · R$ 17,35

MÍDIA (tabela compacta)
```
Não aparece: vendas, receita, agendamentos, nota de ausência, taxa visita→seguidor.

### 3.2 sales_summary — vendas sem origem

Figura principal: **receita** se informada; senão **vendas**.
Apoio: vendas, agendamentos, ticket médio, custo de mídia por venda.
Funil: alcance → cliques → conversas → agendamentos → vendas (+ placa de receita).
Blocos: eficiência comercial (agendamento→venda, escada de custo), histórico
(vendas e agendamentos em **um tom, dois degraus**), criativo que mais gerou conversas,
mídia resumida. Seguidores, se houver, como figura secundária pequena.

### 3.3 sales_segmented — vendas com origem #1/#2/#3

Tudo do 3.2, mais:
- **ORIGEM**: barra horizontal ordenada por fonte (vendas; receita quando houver) com
  "sem origem" em cinza no fim — a cobertura aparece na própria barra ("3 de 5 com origem").
- Vendas descritas (todas as linhas; tabela pode ir para a página seguinte).
- ROAS por fonte **só** com receita por fonte.

### 3.4 Combinações
| Informado | Figura principal | Observação |
|---|---|---|
| agendamentos | agendamentos | funil termina em agendamentos |
| vendas + agendamentos | vendas | eficiência agendamento→venda em destaque |
| vendas + receita | receita | ticket e escada de custo |
| vendas + seguidores | receita/vendas | seguidores vira bloco H compacto |
| nada | — | relatório curto: manchete "Sem resultado comercial registrado nesta semana" + mídia resumida + criativo. Sem funil comercial; funil de mídia |

## 4. Regras do funil

**Sempre presente.** Mínimo de 2 etapas; se só houver uma métrica, placa única.

**Catálogo de etapas** (em ordem; etapa sem dado real é pulada, nunca estimada):
| Etapa | Fonte |
|---|---|
| Alcance | API |
| Cliques | API (`cliquesLink` para site; `cliques` nos demais) |
| Visitas | API (`landingPageViews` quando o objetivo dominante é site; `profileVisits` quando é perfil) |
| Conversas | API (`contatos`) |
| Agendamentos | feedback |
| Vendas | feedback |
| Seguidores novos | feedback (total − total anterior) |
| Total do perfil | feedback — desenhada como **placa-base**, não trapézio |

**Por relatório/modo**
- R1 conta com conversa: alcance → cliques → visitas → conversas.
- R1 conta sem conversa: alcance → cliques → visitas ao perfil. (R1 é gerado antes do
  feedback; não mostra seguidores.)
- R2 vendas: alcance → cliques → conversas → agendamentos → vendas.
- R2 seguidores: alcance → visitas ao perfil → seguidores novos → total do perfil.

**Geometria**
- Largura por etapa em escala **logarítmica** entre 34% e 100% da coluna — proporcional e
  legível (23 não some ao lado de 16.429).
- Largura **nunca aumenta**: se uma etapa vale mais que a anterior (ex.: 562 visitas ao
  perfil × 404 cliques), a largura é limitada à da anterior; o número continua real.
- Número e rótulo dentro do trapézio quando couberem com folga; senão, à direita com linha-guia.
- Altura por etapa fixa; funil com 5 etapas ocupa meia página, com 2 ocupa um terço.

**Taxas**
- Entre etapas da mesma fonte: sim, por extenso ("2,9% clicaram").
- Entre fontes diferentes: **não por padrão** (sem "seguidores = 6,58% das visitas"). A
  limitação vai uma vez no rodapé.
- A maior queda relativa entre etapas da mídia ganha ênfase de cor (não alerta).

## 5. Hierarquia por modo

```
R1 — ANÚNCIOS
resultado principal da conta   ████████████
funil                          ██████████
criativos                      ██████████
comparação por objetivo        ████████
tendência                      ████
detalhe de campanha            ███

R2 — FOLLOWERS_ONLY
seguidores novos               ████████████
crescimento / total            █████████
evolução do perfil             ████████
visitas ao perfil              ██████
criativo que levou ao perfil   █████
investimento / mídia           ███

R2 — SALES_SUMMARY
receita (ou vendas)            ████████████
vendas / agendamentos          █████████
eficiência comercial           ████████
funil                          ███████
histórico                      ██████
criativo                       ████
seguidores                     ███
mídia                          ███

R2 — SALES_SEGMENTED
receita                        ████████████
vendas                         ██████████
origem                         █████████
eficiência comercial           ███████
vendas descritas               ██████
histórico                      █████
mídia                          ███
```

Tradução em tamanho: figura principal 30 pt · figuras de apoio 20 pt · KPIs 13 pt · tabela 7,5 pt.

## 6. Regras de criativos

**Conjunto relevante:** investimento ≥ R$ 2 **ou** impressões ≥ 100.

**Destaques possíveis** (cada criativo recebe no máximo 2; nunca "Estável"):
| Destaque | Regra |
|---|---|
| Mais conversas | maior nº de conversas (> 0) |
| Mais cliques | maior nº de cliques |
| Melhor CTR | maior CTR com impressões ≥ 1.000 e investimento ≥ R$ 5 |
| Maior investimento | maior gasto, se ≥ 30% do total |
| Maior eficiência | menor custo por resultado com ≥ 2 resultados |
| Tráfego sem conversão | cliques ≥ percentil 75 e 0 conversas (só em conta com conversa) |
| Atenção sem resposta | ≥ 15% da verba e CTR < metade da mediana |
| Sinal de saturação | frequência ≥ 3 e CTR em queda ≥ 25% vs. semana anterior |
| Explica a mudança | maior contribuição absoluta para a variação do resultado principal vs. semana anterior |

**Seleção de destaques:** ordenar por relevância para o objetivo da conta (conversa → Mais
conversas / Maior eficiência / Tráfego sem conversão; visitas → Mais cliques / Melhor CTR /
Atenção sem resposta), um criativo por cartão.

**Layout por quantidade**
| Relevantes com destaque | Cartões |
|---|---|
| 1 | 1 cartão largo (preview grande à esquerda) |
| 2 | 2 cartões de meia largura |
| 3 | 3 cartões de um terço |
| 4+ | 3 cartões + tabela; 4 em 2×2 quando todos tiverem preview |

**Tabela completa** (todos os relevantes, sem limite; pode seguir para a página seguinte com
cabeçalho repetido): miniatura · criativo · campanha · investimento · impressões · alcance ·
cliques · CTR · resultado principal · custo por resultado · destaque. Números tabulares,
linha de destaque sombreada, ordenação por investimento.

**R2:** 1–2 criativos, escolhidos pela conversão principal (vendas/agendamentos → mais
conversas; seguidores → mais cliques ou mais visitas). Sem tabela.

## 7. Regras de previews

1. **Coleta** (Automação 1, na geração): para os criativos relevantes, pedir o nó do criativo
   com `thumbnail_url&thumbnail_width=600&thumbnail_height=600` (lote por `ids=`).
2. **Armazenamento:** baixar na hora (URL assinada expira) e salvar no storage
   (`{cliente}/criativos/{adId}-{periodo}.jpg`); caminho vai para
   `traffic_reports.snapshot.creatives[]`.
3. **Render:** o PDF lê o arquivo guardado — nunca a URL do Facebook. Relatório 2 reusa o
   mesmo arquivo pelo snapshot.
4. **Tamanhos:** cartão 64–72 pt (1:1), cartão largo 110 pt, tabela 18 pt.
5. **Falha / ausência:** caixa 1:1 neutra com o tipo (vídeo / carrossel) e iniciais; falha
   de download nunca derruba o relatório.
6. **Link:** anotação clicável para `instagram_permalink_url` quando existir ("ver post").
7. **Custo:** 1 chamada por lote + ~40 KB por criativo relevante.

## 8. Regras de histórico

| Pontos com dado | Forma |
|---|---|
| 1 | nada (seção some) |
| 2 | **comparação em figura**: "1.214 → 1.251 (+37)" / "4 → 5 vendas" |
| 3–4 | gráfico pequeno (1/2 largura) |
| 5+ | tendência completa (largura total), rótulo só nas pontas |

- **Seguidores:** linha do total (eixo não começa em zero, rótulo do eixo explícito) + colunas
  finas do ganho semanal em gráfico separado — nunca eixo duplo.
- **Vendas e agendamentos:** colunas agrupadas em **uma matiz, dois tons** (agendamento claro,
  venda escuro); receita em gráfico próprio quando tiver 3+ pontos.
- **Mídia (R1):** pequenos múltiplos de investimento, resultado e custo por resultado a partir
  de 3 semanas (fonte: `traffic_reports` ou API).
- Acumulado ("+118 seguidores em 4 semanas") como figura quando houver 3+ semanas.

## 9. Regras de análise textual

**Formato:** resultado → contexto → interpretação. Uma ideia por frase; no máximo 2 números
por frase.

**Seleção:** 2–4 frases por relatório, escolhidas de um catálogo pontuado:
| Tipo | Condição | Exemplo |
|---|---|---|
| Eficiência com menos verba | investimento caiu ≥ 10% e custo por resultado melhorou | "Com 21% menos investimento, a operação manteve 23 conversas a um custo 10% menor." |
| Concentração por objetivo | parte do resultado ÷ parte da verba ≥ 1,5 | "Engajamento concentrou o resultado: recebeu 38% da verba e gerou 78% das conversas." |
| Criativo concentrador | criativo com ≥ 50% do resultado | "ad promos agosto concentrou 78% das conversas." |
| Tráfego sem conversão | destaque existente | "ad trafego apresentação loja levou 193 cliques, mas nenhuma conversa." |
| Estabilidade apesar de queda | volume caiu ≥ 15% e resultado variou < 5% | "Mesmo com alcance menor, as visitas ao perfil ficaram estáveis." |
| Crescimento de audiência | ganho > 0 | "O perfil ganhou 37 seguidores e cresceu 3,05%." |
| Sequência | 3ª semana seguida de alta | "Terceira semana seguida de crescimento." |
| Oportunidade | criativo de melhor eficiência com < 20% da verba | "O criativo mais eficiente recebeu só 12% da verba." |

**Tom**
- Começa pelo resultado mais útil e justo. Queda de volume com ganho de eficiência abre pela
  eficiência.
- Otimista só com dado; nunca "excelente", "incrível"; nunca alarmista.
- Proibido: verbos causais ("porque", "graças a"); listas de 3+ variações numa frase;
  metalinguagem (§9 da auditoria).

**Manchete:** a frase de maior pontuação; títulos de seção podem usar a segunda e a terceira.

## 10. Alertas e notas

**Alerta: no máximo 1 por relatório.** Elegível só se:
1. resultado principal caiu ≥ 20% **e** custo por resultado piorou ≥ 20%; ou
2. métrica técnica crítica de um objetivo **cujo próprio resultado também piorou**; ou
3. criativo com ≥ 25% da verba e zero resultado.

Métrica intermediária crítica com resultado saudável (ex.: CPE +305% com Engajamento gerando 78%
das conversas) **não vira alerta**: aparece em vermelho na tabela comparativa.

**Nota metodológica: uma, no rodapé.**
- R2 com resultado comercial: "Resultados comerciais podem incluir canais além da mídia paga."
- R1: "Alcance somado entre campanhas pode contar a mesma pessoa mais de uma vez." (só com 2+
  campanhas)

## 11. Matriz de componentes

Largura em colunas de 12. "Quebra" = pode começar na página seguinte.

### Relatório 1
| Componente | Obrig. | Condição | Prior. | Mín. | Ideal | Largura | Quebra |
|---|---|---|---|---|---|---|---|
| Abertura (título, período, comparado com) | sim | — | 1 | 40 pt | 48 pt | 12 | não |
| Manchete | sim | — | 1 | 1 linha | 2 linhas | 12 | não |
| Faixa de KPIs | sim | ≥ 3 métricas com dado | 1 | 4 itens | 6 itens | 12 | não |
| Alerta | não | regra §10 | 2 | 1 linha | 2 linhas | 12 | não |
| Funil | **sim** | ≥ 1 etapa | 1 | 2 etapas / 1/3 pág. | 4 etapas / 1/2 pág. | 7 | não |
| Análises | sim | ≥ 2 frases elegíveis | 1 | 2 | 4 | 5 | não |
| Barra verba × resultado | não | objetivos ≥ 2 | 2 | 2 barras | 1 por objetivo | 12 | sim |
| Tabela comparativa por objetivo | não | objetivos ≥ 2 | 2 | 2 linhas | todas | 12 | sim |
| Tabela de campanhas | não | campanhas > objetivos | 3 | 2 linhas | todas | 12 | sim |
| Destaques de criativo | não | relevantes com destaque ≥ 1 | 1 | 1 cartão | 3 cartões | 12 | sim |
| Tabela de criativos | não | relevantes ≥ 2 | 2 | 2 linhas | todas | 12 | sim (cabeçalho repete) |
| Tendência | não | semanas ≥ 3 | 3 | 3 múltiplos pequenos | largura total | 12 | sim |
| Rodapé | sim | — | — | — | — | 12 | fixo |

### Relatório 2
| Componente | Obrig. | Condição | Prior. | Mín. | Ideal | Largura | Quebra |
|---|---|---|---|---|---|---|---|
| Abertura + figura principal | sim | — | 1 | 70 pt | 100 pt | 12 | não |
| Figuras de apoio | sim | ≥ 1 métrica de apoio | 1 | 2 | 4 | 12 | não |
| Funil completo | **sim** | ≥ 1 etapa | 1 | 2 etapas | 5 etapas | 7 | não |
| Análises | sim | ≥ 2 frases | 1 | 2 | 4 | 5 | não |
| Histórico — comparação | não | 2 pontos | 2 | 1 figura | 1 figura | 4 | não |
| Histórico — gráfico | não | ≥ 3 pontos | 2 | 1/2 largura | largura total com 5+ | 6–12 | sim |
| Eficiência comercial | não | vendas e (agendamentos ou receita ou investimento) | 2 | 1 figura + escada | idem | 6 | sim |
| Origem | não | vendas atribuídas ≥ 1 | 2 | 2 barras | 1 por fonte + sem origem | 6 | sim |
| Crescimento de audiência | não | seguidores informados | 1 (seguidores) / 3 (vendas) | 1 figura | figura + evolução | 12 / 4 | sim |
| Vendas descritas | não | linhas ≥ 1 | 3 | 1 linha | todas | 12 | sim (cabeçalho repete) |
| Mídia resumida | não | objetivos ≥ 1 com dado | 4 | 1 linha | 1 por objetivo | 12 | sim |
| Criativo que explica | não | relevantes com resultado ≥ 1 | 3 | 1 cartão | 2 cartões | 6–12 | sim |
| Nota de rodapé | não | resultado comercial presente | — | 1 linha | 1 linha | 12 | fixo |

## 12. Paginação

- Layout **em fluxo**: componentes empilham na ordem do modo e ocupam largura por colunas.
- **Página 1 obrigatória:** abertura, manchete, figura/faixa principal, funil e análises.
- Grupos que não se separam: título de seção + primeira linha/cartão; cartão inteiro; linha de
  tabela. Tabelas podem quebrar entre linhas, **repetindo o cabeçalho**.
- Proibido: página com só rodapé ou nota; título de seção órfão no pé da página; quebra forçada
  que deixe mais de 30% da página vazia (a regra atual `break` na mídia do R2 é removida).
- Tamanho esperado: followers_only simples — 1 página; sales_summary — 1–2; sales_segmented com
  muitas linhas — 2–3; R1 com ≤ 6 criativos — 1–2; R1 com muitos criativos — até 3.
- Sem teto rígido de páginas; o teto é "nenhum componente vazio".

## 13. Sistema visual (ajustes)

- **Escala tipográfica de 6 degraus:** 6,5 · 7,5 · 9 · 12 · 20 · 30 pt. Nenhum texto abaixo de
  6,5 pt.
- **Ritmo de 4 pt:** 4 / 8 / 12 / 16 / 24 / 32.
- **Grid de 12 colunas** na largura útil A4 (~531 pt).
- **Superfícies em 3 níveis:** destaque (fundo suave), cartão (borda), célula (sem borda).
- **Números tabulares** em tabelas; proporcionais em figuras.
- **Paleta:** reprovada no validador (croma baixo; teal × azul ΔE 11,6). Séries com ordem usam
  uma matiz em dois tons; categórico só para objetivos, com rótulo direto; revalidar com
  `validate_palette.js` antes de implementar.
- **Decisão pendente — fonte da figura principal:** o `dataviz` cataloga serif na figura principal
  como anti-padrão; Fraunces é a identidade da marca. Recomendação: Inter semibold para números
  de dado e tabelas, Fraunces só no título do relatório.

## 14. Impacto técnico previsto (para a fase de implementação)

- `metaInsights`: coleta de miniatura 600 px por lote de criativos; campos de impressões, CTR,
  frequência e landing views já existem.
- `reportEntities`/`traffic_reports.snapshot`: acrescentar criativos com caminho do preview.
  **Sem migração** — o snapshot já é jsonb.
- Storage: pasta de criativos por cliente.
- `adsInsights`: catálogo de destaques, regras de análise, regra de alerta, manchete sensível a
  investimento.
- `conversionFocus`: modos com hierarquia própria, funil com placa-base, histórico por número
  de pontos.
- `reportBlocks`: funil proporcional, figura principal, barra pareada, tabela comparativa,
  cartões com preview, linha de tendência, rodapé com nota.
- Testes: um cenário por modo (followers_only, sales_summary, sales_segmented, nada informado)
  com 1, 2 e 4 semanas de série; paginação com 2 e 12 criativos.

---

## 15. Decisão por parte do relatório

### Relatório 1
| Parte | Decisão | O que muda |
|---|---|---|
| Cabeçalho | MANTER | — |
| "comparado com …" | MANTER | é informação, não metalinguagem |
| Manchete (`mediaNarrative`) | SIMPLIFICAR | resultado → contexto; considerar investimento; sem lista de números |
| Faixa de KPIs | AUMENTAR DE DESTAQUE | incluir impressões; CTR quando o resultado é clique |
| Cartões "Distribuição da verba" / "De onde vieram as conversas" | REMOVER | viram 1 frase de concentração + barra pareada |
| Funil | AUMENTAR DE DESTAQUE | sempre presente; proporcional (log); etapa de visitas |
| Pilha lateral do funil | SIMPLIFICAR | 1–2 números que o funil não mostra |
| Cartão de atenção | TORNAR CONDICIONAL | só pela regra §10 |
| Painéis por objetivo (máx. 2) | REMOVER | substituídos pela tabela comparativa |
| Tabela comparativa por objetivo | NOVO COMPONENTE | linhas alinhadas, todos os objetivos |
| Barra verba × resultado | NOVO COMPONENTE | parte-do-todo pareada |
| Tabela de campanhas | NOVO COMPONENTE (condicional) | quando campanhas > objetivos |
| Destaques de criativo | AUMENTAR DE DESTAQUE | preview, até 2 destaques por criativo, catálogo ampliado |
| Tabela de criativos | AUMENTAR DE DESTAQUE | sem limite; impressões, CTR, custo por resultado |
| Rótulo "Estável" | REMOVER | — |
| Nota "custos unitários só aparecem…" | REMOVER | — |
| "leitura agregada" / "comparação direta" / "leitura por regra" | REMOVER | — |
| Tendência de mídia | NOVO COMPONENTE (condicional) | 3+ semanas |
| Nota de alcance somado | TORNAR CONDICIONAL | rodapé, 2+ campanhas |

### Relatório 2
| Parte | Decisão | O que muda |
|---|---|---|
| Figura principal | AUMENTAR DE DESTAQUE | 30 pt; muda por modo |
| Faixa única de KPIs | SIMPLIFICAR | figura principal + apoio |
| Manchete (`salesHeadline`/`followersNarrative`) | SIMPLIFICAR | resultado → contexto → interpretação |
| Nota "Não informado no feedback…" | REMOVER | ausência não vira conteúdo |
| Funil completo | MANTER / AUMENTAR | placa-base "total do perfil"; sem taxa entre fontes |
| Nota de fontes no funil | REMOVER | vai para o rodapé |
| Pilha lateral do funil | SIMPLIFICAR | só o que o funil não mostra |
| Eficiência comercial | MANTER | — |
| Origem por fonte | SIMPLIFICAR | barra ordenada com "sem origem"; cobertura na própria barra |
| Nota de origem | REMOVER | — |
| Histórico de 2 pontos em colunas | REMOVER | vira figura "antes → depois" |
| Histórico 3+ | TORNAR CONDICIONAL | linha (seguidores) / colunas em dois tons (vendas) |
| Crescimento de audiência | NOVO COMPONENTE | modo seguidores |
| Painéis de mídia + "mesmos dados do relatório 1" | SIMPLIFICAR | tabela compacta por objetivo, sem rótulo |
| Quebra forçada antes da mídia | REMOVER | paginação em fluxo |
| Criativos (3 cartões genéricos) | SIMPLIFICAR | 1–2 criativos ligados à conversão principal, com preview |
| Vendas descritas | AUMENTAR | sem limite de 10 |
| Cartões "inclui outros canais" (3×) + rodapé | SIMPLIFICAR | 1 nota no rodapé |

---

## Perguntas em aberto (para decidir antes de implementar)

1. **Fonte da figura principal** — Inter (recomendação `dataviz`) ou manter Fraunces (marca)?
2. **CTR na faixa do R1** — só em contas de tráfego para site, ou sempre com explicação?
3. **Tendência de mídia (R1)** — buscar semanas anteriores na API a cada geração, ou usar só
   `traffic_reports` acumulados (começa vazio e cresce)?
4. **Link "ver post"** no preview — desejado no PDF enviado ao cliente?
