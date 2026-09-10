-- P0-B: fluxo criado por dentro de um Plano de Ação não virava pai completo.
--
-- Causa-raiz (ver docs/ARQUITETURA-TAREFAS.md e a revisão de fluxos de
-- 2026-09-09): a promoção "tipo comum → Entrega" só existia no POST
-- (createFlowDelivery, app/api/admin/tasks/route.ts). O PATCH
-- (app/api/admin/tasks/[id]/route.ts) não tinha equivalente — então uma
-- atividade comum criada dentro de um Plano de Ação e depois trocada para um
-- tipo Entrega (ex.: Criativo) pelo seletor de Tipo do modal nascia com o
-- `kind` novo e mais nada: sem `payload.flow_parent`, sem peso congelado, sem
-- etapa nenhuma — um pai pelado, que não aparece certo em lugar nenhum (não
-- cascateia, e a caixa de Etapas não tem o que mostrar).
--
-- Confirmado em produção: card `04331233-cd17-4e64-a690-dfb53982f598`
-- ("Criativo teste fluxo dentro de plano tock - criado por dentro"), membro do
-- plano `00973f0e-12dd-44ee-bb24-68cf75a892c5`.
--
-- O código já ganhou a promoção equivalente no PATCH
-- (promoteTaskToFlowDelivery, lib/supabase.ts, reusada de
-- app/api/admin/tasks/[id]/route.ts) — esta migração é só o BACK-FILL dos
-- cards que já quebraram antes desse fix subir. Nada aqui precisa rodar de
-- novo depois que o PATCH promove direito na hora da troca de Tipo.
--
-- Por que o corte de data (`created_at >= '2026-08-30'`): `kind = 'criativo'`
-- sem `flow_parent` também descreve TODO card Criativo anterior aos fluxos em
-- cascata — antes de 2026-08-30 "Criativo" era só um tipo de trabalho comum,
-- sem o conceito de corrente de etapas (ver ARQUITETURA-TAREFAS.md: "A marca
-- payload.flow_parent é explícita de propósito... inferir 'criativo sem
-- subtipo = entrega' os transformaria em pais de uma hora para outra — sumiriam
-- do quadro e passariam a marcar 0%"). Sem o corte, esta consulta bateria em
-- ~20 cards legítimos (ex.: "KARPINSKI - Publicação Semanal", vários "Reels
-- Karpinski - Postagem …") que são trabalho comum antigo, não entregas
-- quebradas — promovê-los seria o MESMO bug ao contrário. Conferido por SQL
-- direto em produção (projeto rqwycltgnnvaunvmyxea) em 2026-09-09: com este
-- corte, exatamente 1 linha bate — o card citado acima. Sem o corte, batiam 20.
--
-- O que esta migração NÃO faz: não materializa a primeira etapa. Fazer isso
-- em SQL puro duplicaria `flowStepFields` (lib/flows/stepFields.ts) — título,
-- prazo por `lead_days`, responsável default, peso — código já testado que
-- não deveria ganhar uma segunda versão desalinhada em migration. Em vez
-- disso, esta migração só marca as três chaves de payload e o status; a
-- varredura diária (`reconcileFlows`, lib/flows/reconcile.ts) já procura por
-- "entrega com flow_parent=true e nenhuma etapa ligada" e materializa a
-- primeira etapa por conta própria — é a MESMA rede que resgata a ocorrência
-- de uma entrega recorrente que "nasce vazia". Quem aplicar esta migração e
-- quiser a etapa na hora (sem esperar a cron do dia seguinte) pode disparar
-- manualmente POST /api/admin/automations/run como admin.
--
-- Idempotente: uma vez marcado `flow_parent = true`, a linha sai do filtro
-- (`coalesce(payload->>'flow_parent','false') <> 'true'`) — rodar esta
-- migração de novo não repete o UPDATE em quem ela já corrigiu.
do $$
declare
  affected record;
begin
  for affected in
    select
      t.id,
      t.title,
      (
        select coalesce(sum(coalesce(sub.progress_weight, 1)), 0)
        from public.task_types sub
        where sub.parent_id = tt.id and sub.active
      ) as total_weight,
      (
        select count(*)
        from public.task_types sub
        where sub.parent_id = tt.id and sub.active
      ) as step_count
    from public.tasks t
    join public.task_types tt on tt.key = t.kind and tt.parent_id is null
    where tt.behavior = 'entrega'
      -- Subtype nulo = o topo de uma entrega (uma etapa carrega o subtype da
      -- etapa; o pai não tem subtype). Filtra fora as próprias etapas.
      and t.subtype is null
      and coalesce(t.payload->>'flow_parent', 'false') <> 'true'
      -- Ver comentário acima: exclui todo o histórico anterior à cascata.
      and t.created_at >= '2026-08-30'
      and not exists (
        select 1 from public.task_links tl where tl.parent_id = t.id and tl.slot is not null
      )
  loop
    update public.tasks
    set payload = payload || jsonb_build_object(
          'flow_parent', true,
          'flow_total_weight', affected.total_weight,
          'flow_step_count', affected.step_count
        ),
        -- Mesma razão de createFlowDelivery/promoteTaskToFlowDelivery: uma
        -- entrega não aparece no quadro (status derivado dos filhos), então
        -- deixá-la em Backlog a prenderia num arrasto que ninguém vai dar.
        status = 'em_producao'::task_status,
        updated_at = now()
    where id = affected.id;

    raise notice 'P0-B backfill: card % ("%") promovido a entrega — peso congelado em %, % etapa(s) no molde.',
      affected.id, affected.title, affected.total_weight, affected.step_count;
  end loop;
end $$;
