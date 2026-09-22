# Diferença de schema aplicada em produção — 2026-09-16

As migrations `20260916232701` e `20260916232706` foram aplicadas diretamente
ao Supabase de produção e registradas no ledger. Não houve DML persistente de
validação. O vínculo legado cross-client em `task_links` foi preservado para
decisão operacional posterior; as novas regras impedem novas violações.

```mermaid
flowchart LR
  C[clients]

  subgraph Antes[Antes: gargalos e integridade parcial]
    T0[tasks]
    L0[task_links\nsem validação de tenant/ciclo concorrente]
    M0[task_metrics\nRLS UPDATE com check incompleto]
    Cache0[meta_insights_cache\n1 JSONB por conta/fonte]
    T0 --> L0
    T0 --> M0
    C --> T0
    C --> Cache0
  end

  subgraph Depois[Depois: schema aplicado]
    T[tasks\n+ índices de quadro/filtro\n+ trigger de troca de cliente]
    L[task_links\n+ slot único\n+ validação tenant + ciclo serializada]
    M[task_metrics\n+ janela temporal validada\n+ RLS UPDATE revalida automação]
    Cache[meta_insights_cache\n+ índices de janela\n+ checks de intervalo/payload]

    P[performance_trace_points\nraw, append-only]
    R[performance_trace_rollups\nLOD first/min/max/last]
    S[performance_trace_stationary_windows\nfaixas estáveis]
    K[performance_trace_chunks\nstatus/cursor/tentativas\nsem sobreposição]

    C --> T
    T --> L
    T --> M
    C --> Cache
    C --> P
    C --> R
    C --> S
    C --> K
    K -. sincroniza .-> P
    P -. agrega .-> R
    P -. detecta .-> S
  end
```

## Mudanças materiais

| Área | Antes | Aplicado |
| --- | --- | --- |
| CRUD de tasks | leituras de quadro sem os índices compostos dedicados | índices para quadro, não atribuídas, tipo, fluxo e relações |
| Grafo de tasks | podia aceitar ciclo concorrente, slot duplicado e alteração posterior de tenant | lock transacional do grafo, índice único por slot e triggers de integridade |
| Métricas/cache | checks temporais ausentes; cache JSONB sem índice de janela | constraints `NOT VALID` para novas escritas e índice por cliente/fonte/janela |
| Trace amplo/zoom | não havia armazenamento temporal normalizado | raw points, envelopes LOD, janelas paradas e chunks de ingestão com RLS |

`meta_insights_cache` continua compatível com o runtime atual e ainda mantém a
unicidade por `(account_id, datasource)`. As novas consultas por janelas devem
migrar para `performance_trace_*`; alterar a chave do cache legado exigirá o
cutover do consumidor, não apenas um índice.
