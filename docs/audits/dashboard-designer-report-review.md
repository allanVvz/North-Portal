# Revisão dos relatórios — dashboard-designer

Data: 2026-09-15. Skill aplicada: `.claude/skills/dashboard-designer` (instalada depois
da auditoria de UI da manhã — ver nota em `report-ui-baseline.md`).

**Base da análise.** PDFs reais gerados hoje pelo caminho do cron, num molde de teste
isolado da CRIS CAR CARE (semana 09/09–15/09): `relatorio-trafego-2026-09-15.pdf` e
`relatorio-vendas-2026-09-15-…pdf`, abertos e lidos na tela. O relatório de vendas foi
comentado com números de exemplo ("8 agendamentos, 5 vendas, R$ 4.100, seguidores 829 →
841, #1 1200, #1 800, #2 900") e saiu em `sales_segmented`. O que não coube na tela (tabelas
do fim da página de vendas; os modos `followers_only` e `sales_summary`, que não foram
gerados) foi lido no código — está marcado como **[código]**.

Nenhum código foi alterado.

---

## 0. Pipeline — o que cada relatório pode e não pode afirmar

| | Relatório de anúncios | Relatório de vendas |
|---|---|---|
| Automação | `relatorio_trafego_semanal` (`lib/automations/run.ts`) | `relatorio_vendas` (`lib/automations/conversionFlow.ts`) |
| Fonte | API Meta/Windsor, automática, completa | Comentário humano, livre, **parcial por natureza** |
| Quando | `due_date` do molde (cron) | depois da revisão final do tráfego + comentário |
| Registro | `traffic_reports` (snapshot dos posts) | `conversion_reports` (modo, métricas, atribuição) |
| Modos | um só | `followers_only` · `sales_summary` · `sales_segmented` · `no_data` |
| Pode afirmar | o que a mídia entregou e quanto custou | o que o negócio relatou e quanto disso tem origem identificada |
| **Não pode afirmar** | resultado comercial | **que a mídia causou todo o resultado** — as vendas relatadas vêm de todos os canais |

A última linha é o critério que mais pesa nesta revisão. Várias peças atuais do relatório
de vendas cruzam dado de mídia (conversas, investimento) com dado comercial total
(agendamentos, vendas, receita) como se fossem da mesma jornada. Não são.

---

# Relatório 1 — Anúncios / Tráfego

## 1.1 Audiência e pergunta

| | |
|---|---|
| Quem lê | o gestor de tráfego (decide) e o cliente (acompanha) |
| Decisão que informa | onde a verba rende; que criativo escalar, qual pausar |
| Frequência | semanal |
| Arquétipo | **operacional enxuto** — 3–5 KPIs de manchete, detalhe investigável abaixo |
| **Pergunta principal** | **"A mídia gerou conversas a um custo aceitável nesta semana — e onde isso melhorou ou piorou?"** |

## 1.2 Classificação dos KPIs

| Nível | KPI | Por quê |
|---|---|---|
| **Primário** | Conversas (mensagens) — total | é o desfecho que a equipe conta em todo objetivo (`BLOCK_KPIS` coloca "Mensagens" em todos os blocos) |
| **Primário** | Custo por conversa — total | a eficiência que decide verba |
| **Primário** | Investimento — total | contexto obrigatório, **neutro** (sem cor de bom/ruim) |
| Secundário | Alcance, cliques no site, visitas ao perfil, engajamento — por objetivo | explicam de onde vieram as conversas |
| Secundário | CPC, custo por engajamento, custo por visita — por objetivo | eficiência de meio de funil |
| Diagnóstico | Impressões, CTR, CPM | investigação de criativo e de entrega |
| Diagnóstico | Linhas de criativo | a ação ("escala/pausa") mora aqui |

## 1.3 Arquitetura atual (como está)

```
Cabeçalho
RESULTADOS POR CAMPANHA
  Tráfego para o site   [6 cartões]
  Engajamento           [6 cartões]
CRIATIVOS
  3 tabelas (uma por campanha), 7 colunas, até 3 linhas
EFICIÊNCIA DE MÍDIA     (desligada no template padrão)
VISÃO GERAL › Funil de aquisição   ← último
```

## 1.4 Crítica

**Não existe manchete.** O documento abre em "Tráfego para o site › Investimento
R$ 114,96". O total da semana — **R$ 184,78 investidos, 23 conversas** — não aparece em
lugar nenhum do relatório de anúncios. Quem quiser saber precisa somar
114,96 + 69,82 e 5 + 18 de cabeça. (O relatório de **vendas** mostra os R$ 184,78; os dois
documentos da mesma semana não concordam sobre qual é o número de topo.)

**O sinal mais importante está no pior lugar.** "Custo por engajamento R$ 0,17 **↑305%**"
e "Engajamento 401 **↓80%**" são os dois movimentos mais fortes da semana. Estão no 11º e
12º cartão, canto inferior direito da grade, com o mesmo peso de "Mensagens 5". Pelo padrão
F, é a última coisa lida.

**Doze cartões com peso idêntico (card soup).** A comparação que o leitor precisa é
horizontal — *tráfego rendeu mais que engajamento?* — e o layout a obriga a ser vertical e
de memória, porque cada objetivo é um bloco de 6 cartões empilhado.

**A tabela de criativos não responde à pergunta dela.** Ordena por investimento e mostra 3
por campanha; nada diz qual é o melhor ou o pior. Exemplos reais da semana:
- "ad trafego apresentação loja": **193 cliques, CTR 4,15%, 0 mensagens** — o criativo que
  mais traz tráfego e nenhuma conversa; é o achado acionável da tabela e não tem destaque.
- "ad a loja online PPF": alcance 4, 4 impressões, R$ 0,07 — ocupa um dos 3 slots da
  campanha com ruído.
- Coluna "#" inteira em "—" (a CRIS CAR CARE não tem tags de fonte).

**O funil está no fim.** É a peça que se lê sem legenda.

**Semântica.** Investimento recebe cor de julgamento ("↓22,77%" pintado como bom, porque
`metricRefInverse("custo")` é "menor é melhor"). Datas ISO no subtítulo
(`2026-09-09 a 2026-09-15 · gerado em 15/09/2026`). "vs. anterior" repetido 12 vezes sem
dizer qual é o anterior.

## 1.5 Redundâncias

| Informação | Onde aparece | Problema |
|---|---|---|
| Investimento | cartão por objetivo ×2; coluna "Invest." de criativo; painel do funil | nunca como total |
| Mensagens | cartão por objetivo ×2; coluna de criativo; fim do funil | idem |
| "vs. anterior" | 12× | legenda única resolve |
| Coluna "#" | 3 tabelas | vazia sem tags |

## 1.6 Densidade visual

Alta nos lugares errados: 12 cartões + 3 tabelas + funil numa folha. O que é denso (os
cartões) é o que menos decide; o que decide (criativo vencedor/perdedor, variação de custo)
é o que tem menos destaque.

## 1.7 Hierarquia proposta

```
┌──────────────────────────────────────────────────────────────────┐
│ Relatório de anúncios — CRIS CAR CARE · 09/09 a 15/09            │
│ "<frase por regra — ex.: engajamento ficou 4× mais caro>"        │ ← frase por regra
├──────────────────────────────────────────────────────────────────┤
│  23 conversas     R$ 8,03 / conversa     R$ 184,78 investidos    │ ← L1: 3 números, grandes
│  Δ% (cor)         Δ% (cor invertida)     Δ% (sem cor)            │
│  comparado com <período real da semana anterior>                 │
├──────────────────────────────────────────────────────────────────┤
│ ALCANCE ─ x% ─▶ CLIQUES ─ y% ─▶ CONVERSAS         jornada agregada│ ← funil horizontal, taxas ENTRE etapas
├────────────────────────────┬─────────────────────────────────────┤
│              Tráfego  Engaj.│  CRIATIVOS                          │
│ Investimento  114,96  69,82 │  ▲ TOP      ad promos agosto  18 msg │
│ Alcance       11.913  4.496 │  ⚠ ATENÇÃO  ad trafego apres.  193  │
│ Mensagens          5     18 │             cliques, 0 conversas    │
│ Custo/result.  23,0   3,88  │                                     │
│ Δ custo       ↑18%  ↑305% ● │                                     │
├────────────────────────────┴─────────────────────────────────────┤
│ Detalhe: tabela completa de criativos (por campanha)             │ ← L3
└──────────────────────────────────────────────────────────────────┘
```

Os valores absolutos do esboço são os da semana real (23 = 5 + 18; R$ 8,03 = 184,78 ÷ 23;
custo por mensagem 22,99 e 3,88); variações e taxas do funil ficaram como marcadores,
porque este PDF não traz a semana anterior somada.

Regras: a matriz substitui os 12 cartões; o maior movimento da semana ganha marca na
matriz, não depende de posição; estados de criativo por regra determinística (ex.: TOP =
maior conversas/real; ATENÇÃO = gasto > p50 e 0 conversas); coluna "#" só existe se houver
ao menos uma tag.

## 1.8 Primeiros 3 segundos

> **"23 conversas a R$ 8,03 cada — e o engajamento ficou muito mais caro."**

Três números e uma frase. Nada de objetivo, criativo ou tabela antes disso.

---

# Relatório 2 — Vendas / Conversão

## 2.1 Audiência e pergunta

| | |
|---|---|
| Quem lê | o dono do negócio |
| Decisão que informa | o investimento está se pagando? o que cobrar da equipe comercial? |
| Frequência | semanal |
| Arquétipo | **estratégico** — 3–5 KPIs, narrativa |
| **Pergunta principal** | **"O que a semana rendeu para o negócio — e quanto disso dá para ligar à mídia?"** |

A segunda metade da pergunta não é opcional. Sem ela o relatório atribui à mídia tudo o
que o negócio vendeu.

## 2.2 Classificação dos KPIs

| Nível | KPI | Condição para existir |
|---|---|---|
| **Primário** | Receita | informada |
| **Primário** | Vendas | informadas |
| **Primário** | Retorno **atribuído** (receita com origem ÷ investimento das origens) | receita por origem informada |
| **Primário** | Seguidores ganhos | **só em `followers_only`**, onde é o resultado |
| Secundário | Agendamentos | informados |
| Secundário | Ticket médio | receita **e** vendas |
| Secundário | Conversão agendamento → venda | agendamentos **e** vendas (mesma fonte: o comentário) |
| Secundário | Seguidores ganhos | nos modos de venda |
| Diagnóstico | Cobertura de atribuição | vendas > 0 |
| Diagnóstico | Resultado por origem #1/#2/#3 | alguma origem |
| Diagnóstico | Total de seguidores do perfil | informado |
| Diagnóstico | Investimento, conversas (contexto de mídia) | snapshot com dados |
| Diagnóstico | Vendas linha a linha | linhas descritas |

Rebaixamentos em relação ao que está no PDF hoje:
- **"Retorno sobre o anúncio 22,19×"** é receita **total** ÷ investimento. Sai de primário
  enquanto não for atribuído; vira diagnóstico, rotulado "receita por real investido (não
  atribuída)".
- **"Seguidores 841"** (total) sai do mesmo peso de "Receita R$ 4.100" nos modos de venda.

## 2.3 Arquitetura atual (como está — `sales_segmented`)

```
Cabeçalho
Frase: "R$ 4.100,00 em receita e 5 vendas fechadas."
RESUMO DO PERÍODO  [6 cartões iguais: receita · vendas · agendamentos · ticket · ROAS · seguidores]
  "Primeira semana da série — ainda sem período anterior para comparar."
DA CONVERSA À VENDA  funil 23 → 8 → 5  +  painel verde "VENDAS 5 · custo por resultado R$ 36,96 · investimento R$ 184,78"
CONTEXTO DA MÍDIA    "R$ 184,78 investidos · 23 conversas · 5 vendas relatadas"
COBERTURA DE ATRIBUIÇÃO  "3 de 5 com origem identificada · 60%"
FONTE DE TRÁFEGO E OBJETIVO  tabela 8 colunas        [código]
VENDAS E AGENDAMENTOS DETALHADOS  tabela 4 colunas   [código]
```

## 2.4 Crítica

### Semântica — afirmações que o dado não sustenta (CRÍTICA)

**O funil liga fontes diferentes.** "23 conversas → 8 agendamentos (34,78%) → 5 vendas".
As 23 conversas são mensagens **de anúncio** (API); os 8 agendamentos são **todos** os que o
negócio fez na semana (comentário), vindos de qualquer canal. A taxa 34,78% sugere que um
terço das conversas de anúncio virou agendamento — o dado não diz isso. Só a etapa
agendamento → venda (62,5%) tem as duas pontas na mesma fonte.

**"Custo por resultado R$ 36,96"** no painel verde é R$ 184,78 ÷ 5 vendas totais. Com
cobertura de atribuição de 60%, o custo por venda **atribuída** seria outro número; o
exibido trata as 5 vendas como vindas da mídia.

**"Retorno sobre o anúncio 22,19×"** tem o mesmo problema, com o nome mais forte do
documento: receita total ÷ investimento.

**Zero vazando em modo sem vendas [código].** A tabela "Fonte de tráfego e objetivo" monta a
linha "Sem tag" a partir dos **anúncios** (tem investimento e conversas), e as colunas
`Agend. detalh.` / `Vendas detalh.` saem de `totalsOf([])` = **0**. Em `followers_only` e em
`sales_summary` sem linhas descritas, o PDF imprime "Vendas detalh. 0" para quem nunca falou
de vendas. É exatamente a regra "ausência não é zero", quebrada numa seção que sobreviveu à
correção de hoje.

### Hierarquia e redundância

**Seis cartões com o mesmo peso.** Receita (primário) e seguidores totais (diagnóstico) têm
o mesmo tamanho, o mesmo acento verde e a mesma posição de grade.

**"Sem comparativo" ×5 + a legenda.** Na primeira semana da série cada cartão repete "Sem
comparativo", e logo abaixo a legenda diz a mesma coisa. Seis vezes a mesma informação.
(Nota: o `deltaSuffix=""` que tirou o "vs. anterior" não cobre o caminho sem comparativo de
`DeltaText`.)

**O painel verde repete o topo.** Ocupa ~60% da largura na altura do funil para dizer
"VENDAS 5" — número que já está na frase, no cartão, na cauda do funil e no contexto.

| Informação | Vezes na página |
|---|---|
| 5 vendas | **5** — frase, cartão, fim do funil, painel verde, "5 vendas relatadas", "3 de 5" |
| R$ 184,78 investidos | **3** — hint do ROAS, painel verde, contexto da mídia |
| 23 conversas | **2** — funil, contexto |
| "sem comparativo" | **6** — 5 cartões + legenda |

### Modos parciais [código]

- **`followers_only`**: frase de audiência (bom), **um cartão** numa grade de 3 colunas (dois
  terços da linha vazios), nota "Não informado: receita, vendas, agendamentos", contexto da
  mídia com investimento e conversas, e a tabela de fontes com o zero vazando. O resultado
  da semana (+12) é o **texto pequeno** abaixo do 841, não o número grande.
- **`sales_summary` (sem receita)**: vendas e agendamentos em 2 cartões, funil com a etapa de
  conversas de outra fonte, painel verde com "custo por resultado" total.
- **`no_data`**: frase correta; o resto do documento continua desenhando contexto de mídia e
  tabela de fontes, que não respondem à pergunta de um relatório de vendas.

### Densidade

Boa no topo (frase + grade), confusa no meio: funil pequeno à esquerda e painel grande à
direita sem relação composicional, seguidos de três seções de uma linha cada (contexto,
cobertura, tabela) com kickers próprios. Sete kickers numa folha.

## 2.5 Hierarquia proposta

Princípio: **o layout é escolhido pelo modo**, não um layout fixo que esconde cartões.

### `sales_segmented` / `sales_summary`

```
┌──────────────────────────────────────────────────────────────────┐
│ Relatório de vendas — CRIS CAR CARE · 09/09 a 15/09              │
│ "R$ 4.100 em receita e 5 vendas; 3 delas com origem nos anúncios."│
├──────────────────────────────────────────────────────────────────┤
│   R$ 4.100              5 vendas              3 de 5              │ ← L1 (grande)
│   receita               ticket R$ 820         com origem (60%)    │   L2 embaixo de cada um (pequeno)
├──────────────────────────────────────────────────────────────────┤
│  8 agendamentos ─ 62,5% ─▶ 5 vendas            funil comercial    │ ← só etapas da MESMA fonte
├────────────────────────────┬─────────────────────────────────────┤
│ RESULTADO POR ORIGEM       │ CONTEXTO DA MÍDIA (não atribuído)   │
│ #1  2 vendas  R$ 2.000     │ R$ 184,78 investidos · 23 conversas │
│ #2  1 venda   R$   900     │ R$ 22 de receita por R$ 1 investido │
│ sem origem  2 vendas       │ (inclui vendas de todos os canais)  │
├────────────────────────────┴─────────────────────────────────────┤
│ Seguidores: +12 na semana (841 no perfil)             ← L2, uma linha │
│ Detalhe venda a venda                                  ← L3          │
└──────────────────────────────────────────────────────────────────┘
```

- Primeira semana: **uma** linha "primeira semana — sem comparativo", nenhum "sem
  comparativo" em cartão.
- Retorno aparece como primário **só** com receita por origem; senão fica no contexto,
  rotulado como não atribuído.
- Conversas **não** entram no funil comercial; ficam no contexto da mídia.
- "Vendas sem origem" é uma linha da tabela de origem, com o número — nunca some.

### `followers_only`

```
┌──────────────────────────────────────────────────────────────────┐
│ Relatório da semana — CRIS CAR CARE · 09/09 a 15/09              │
│                                                                  │
│                 +12                                              │ ← o resultado é o GANHO, grande
│           novos seguidores                                        │
│           841 no perfil · 829 na semana anterior                 │
│                                                                  │
│ Vendas, receita e agendamentos não foram informados nesta semana.│
│ Mídia no período: R$ 184,78 investidos · 23 conversas            │ ← contexto, uma linha
└──────────────────────────────────────────────────────────────────┘
```

(Ilustrativo: 829 é o valor que o comentário de teste citou; no PDF gerado a série não
tinha semana anterior.)

Página editorial curta. Sem funil, sem tabela de origem, sem grade de cartões. Sem
semana anterior na série: "841 seguidores no perfil" grande, e "primeira semana
registrada" como linha de apoio — nunca "+841".

### `no_data`

Frase "Sem números comerciais informados nesta semana." + contexto da mídia em uma linha +
aviso de que o feedback não foi recebido. Nada mais.

## 2.6 Primeiros 3 segundos

| Modo | O que o olho pega |
|---|---|
| `sales_segmented` | **R$ 4.100 · 5 vendas · 60% com origem nos anúncios** |
| `sales_summary` | **5 vendas** (ou receita, quando houver) + a variação dela |
| `followers_only` | **+12 seguidores** |
| `no_data` | **"Sem números comerciais informados"** |

---

# 3. Coerência entre os dois relatórios

| Ponto | Hoje | Proposta |
|---|---|---|
| Número de topo da mídia | vendas mostra R$ 184,78; anúncios não mostra total | os dois mostram o mesmo total, vindo do mesmo snapshot |
| Funil | anúncios: aquisição; vendas: conversa → venda (cruza fontes) | anúncios: alcance → clique → conversa; vendas: agendamento → venda |
| Cor de investimento | "menor é melhor" | neutra nos dois |
| Datas | anúncios ISO; vendas pt-BR | pt-BR nos dois |
| Comparativo | anúncios "vs. anterior" ×12; vendas legenda + "sem comparativo" ×5 | uma legenda por documento |
| Estrutura | vendas ainda usa grade de cartões + funil + painel do anúncios | vendas por modo, editorial; anúncios operacional |

---

# 4. Prioridades

| # | Prioridade | Recomendação | Relatório | Torna a informação… |
|---|---|---|---|---|
| 1 | **CRÍTICA** | Zero vazando nas colunas "detalh." da tabela de fontes em modo sem vendas | vendas | correta |
| 2 | **CRÍTICA** | Funil comercial só com etapas da mesma fonte (tirar conversas → agendamentos) | vendas | correta |
| 3 | **CRÍTICA** | "Retorno sobre o anúncio" e "custo por resultado" rotulados como não atribuídos, ou só com receita por origem | vendas | correta |
| 4 | **ALTA** | Manchete com totais (conversas, custo por conversa, investimento) | anúncios | rápida |
| 5 | **ALTA** | Layout por modo; `followers_only` editorial com o ganho como número grande | vendas | rápida, correta |
| 6 | **ALTA** | Matriz Tráfego × Engajamento no lugar dos 12 cartões | anúncios | fácil |
| 7 | **ALTA** | Painel verde fora; cobertura de atribuição sobe para L1 em `sales_segmented` | vendas | rápida |
| 8 | **MÉDIA** | Estados de criativo por regra (TOP / ATENÇÃO) | anúncios | acionável |
| 9 | **MÉDIA** | "Sem comparativo" dito uma vez; seguidores total rebaixado para L3 | vendas | rápida |
| 10 | **MÉDIA** | Investimento sem cor; datas pt-BR; legenda única | anúncios | correta |
| 11 | **BAIXA** | Coluna "#" condicional; filtrar criativos de gasto irrisório | anúncios | fácil |
| 12 | **BAIXA** | Frase de diagnóstico por regra | anúncios | rápida |

Checklist da skill, estado atual:

| Item | Anúncios | Vendas |
|---|---|---|
| Título afirma o insight, não só a métrica | ✗ | ✓ (frase de abertura) |
| Todo KPI tem comparação | ✓ (sem dizer qual período) | ✓ quando há série |
| Cor consistente | ✗ (investimento) | ✓ |
| Período claramente rotulado | ✗ (ISO) | ✓ |
| Precisão adequada ("R$ 4,1 mil") | parcial | ✗ (`R$ 4.100,00` em manchete) |
| Fonte e data de geração no rodapé | parcial (só data) | parcial |
| 3–5 KPIs de manchete | ✗ (0 totais, 12 cartões) | ✗ (6 iguais) |
