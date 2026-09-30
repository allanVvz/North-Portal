# Diárias, peças e rotina North

## Relações

ADM NORTH é um único cliente interno. O molde `REUNIÃO ROTINA - ALLAN` gera ciclos North. `routine_execution_links` associa cards de qualquer cliente a uma reunião específica por molde, ciclo e data. O vínculo não altera `client_id`, tipo, prazo ou `plan_id` do card; também não entra no rollup estrutural nem avança a reunião quando o plano vinculado é concluído. O mesmo card pode constar em reuniões diferentes, e vários cards podem constar na mesma reunião. `plan_id` em `tasks` continua reservado à execução nativa da recorrência, com mesmo cliente e tipo do molde.

Plano dentro de plano por `task_links.structural_member` é um recurso **provisório** e continua disponível na interface geral de planos. Para registrar trabalho de clientes na Rotina Allan, use o vínculo de execução datado.

Na diária de um cliente, cada peça é uma Entrega. Todas as Entregas da mesma diária apontam para **um Roteiro** e **uma Captação** compartilhados. Cada Entrega tem **uma Edição** e **uma Publicação** próprias. O avanço do workflow cria a Edição após a Captação compartilhada e liga a Publicação depois que a Edição da peça é aprovada. A diária recorrente usa `daily_execution_id`, `daily_script_task_id` e `daily_capture_task_id` para manter essa estrutura. Um arquivo final é um ativo da Entrega, não um novo card; vários finais podem pertencer à mesma peça.

O histórico Baita de 16/09 (seis Reels) e 23/09 (dois anúncios) conserva os Roteiros e Captações existentes. As antigas Edições compartilhadas ficam acessíveis pelo ID com `legacy_shared_stage_archived=true`, fora das listas operacionais. As oito Publicações existentes são reservadas em `prepared_publication_task_id` de cada Entrega e ligadas individualmente após a aprovação da Edição, respeitando a sequência do workflow. “Equilibrando a bebida” continua como a sétima peça do bloco de Reels, com sua Edição própria.

## Revisão e comentários

Uma Edição pode ter `payload.reviewer_ids` além do `reviewer_id` principal. Uma aprovação de qualquer revisora aprova aquela Edição e avança a sua Entrega. Um pedido de ajustes devolve somente a Edição a Em produção e avisa os responsáveis vinculados por `task_assignees`.

O comentário de uma Entrega vai para a etapa em execução. O comentário de revisão vai para a etapa revisada. Em planos com várias peças, o autor escolhe a peça ou etapa; `plan_note=true` reserva um comentário sobre o próprio plano ou reunião. O resolvedor valida os elos ao atravessar plano North → plano do cliente → Entrega → etapa. Os comentários automáticos usam a assinatura North AI e sua marca; a autoria humana histórica é preservada.

## Operação de migração

Preflight de produção em 29/09/2026, projeto `rqwycltgnnvaunvmyxea`: ledger remoto em `20260927185112 automation_rules_v1`; `tasks.plan_id` referencia o molde de recorrência, `task_links` guarda membros e etapas, `task_assignees` guarda responsáveis e `notifications` guarda avisos. O único `plan_id` entre clientes era o plano Baita `7e1a162d-ff0f-414e-ad50-bea8b472fbcd` apontando ao molde North `71e87469-990b-416e-9d0e-a6f57e781343`. O ciclo North de 16/09 é `e5f32ccc-154a-4d11-b5dc-1098bec58fcc`. Havia oito elos para duas Edições compartilhadas e nove workspaces de criativos, incluindo “Equilibrando a bebida”. O snapshot completo das linhas alteradas é gravado na tabela privada de auditoria dentro da transação da migração.

Novo preflight em 29/09/2026, antes de `20260929062000`: ledger remoto em `20260929042154 baita_routine_and_piece_reviews`; molde e ciclo North preservados, plano Baita com `client_id=4f2bfda6-325d-4da3-94ff-c64802e1e2a4` e `plan_id=null`; o elo estrutural entre ciclo e plano já estava ausente. A migração cria `routine_execution_links` e insere a associação para 16/09. A reversão remove a tabela e retorna ao estado observado neste preflight; antes de usá-la após novos vínculos, exporte ou reconcilie os registros adicionados.

O SQL versionado de 29/09/2026 inclui imagens anteriores em `migration_audit.baita_routine_20260929`. Os scripts de operação usam `SUPABASE_DB_URL` do `.env.local`, o Session pooler e `pg` instalado em `/tmp/north-db` (`npm install --prefix /tmp/north-db --no-save pg`); rode com `NODE_OPTIONS=--use-system-ca`. Execute `scripts/preflight-baita-routine.mjs` em leitura, depois `scripts/run-baita-routine-migration.mjs --dry-run-rollback`, antes de `--apply`. A aplicação e o rollback são transacionais. `supabase/postflight/20260929042154_baita_routine_and_piece_reviews.sql` verifica as relações, as oito Edições, os comentários e o resumo da Captação. Depois do postflight, `--record-ledger` registra a versão remota. O rollback recusa descartar revisão ou publicação posterior ao corte; nesse caso, reconcilie manualmente os novos registros.
