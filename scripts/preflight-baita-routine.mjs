// Read-only snapshot for the Baita/North routine repair.
import { createRequire } from "node:module";
import { loadEnvLocal, requireEnv } from "./lib/env.mjs";

loadEnvLocal();
const { SUPABASE_DB_URL } = requireEnv(["SUPABASE_DB_URL"]);
const pg = createRequire("/tmp/north-db/package.json")("pg");
if (!new URL(SUPABASE_DB_URL).hostname.includes("pooler.supabase.com")) throw new Error("Use o Session pooler.");
const db = new pg.Client({ connectionString: SUPABASE_DB_URL, application_name: "north-baita-routine-preflight" });
const sections = {
  ledger: `select version,name from supabase_migrations.schema_migrations order by version desc limit 12`,
  ledgerSchema: `select column_name,data_type,is_nullable,column_default from information_schema.columns where table_schema='supabase_migrations' and table_name='schema_migrations' order by ordinal_position`,
  ledgerLatest: `select version,name,cardinality(statements) as statement_count,created_by,idempotency_key,cardinality(rollback) as rollback_count from supabase_migrations.schema_migrations order by version desc limit 3`,
  schema: `select table_name,column_name,data_type from information_schema.columns where table_schema='public' and table_name in ('tasks','task_links','task_assignees','workflow_version_steps','profiles','notifications') order by table_name,ordinal_position`,
  clients: `select id,slug,name from public.clients where slug ilike '%north%' or slug ilike '%baita%'`,
  plans: `select id,client_id,title,kind,subtype,status,due_date,plan_id,reviewer_id,workflow_version_id,recurrence_cadence,payload->>'recurrence_parent_id' as recurrence_parent_id,payload->>'occurrence_date' as occurrence_date,payload->>'recurrence_cycle' as recurrence_cycle from public.tasks where title ilike '%REUNIÃO ROTINA%ALLAN%' or title ilike '%Setembro%Outubro%' or id='7e1a162d-ff0f-414e-ad50-bea8b472fbcd' order by title,created_at`,
  planLinks: `select l.* from public.task_links l where l.parent_id='7e1a162d-ff0f-414e-ad50-bea8b472fbcd' or l.child_id='7e1a162d-ff0f-414e-ad50-bea8b472fbcd' order by parent_id,position`,
  creative: `select t.id,t.client_id,t.title,t.kind,t.subtype,t.status,t.due_date,t.assignee,t.reviewer_id,t.workflow_version_id,t.completed_at,t.payload->'comments' as comments from public.tasks t where t.title ilike any(array['%6 Reels%','%2 Anúncios%','%Equilibrando a bebida%','%Promoções da Semana%','%Paz de Espírito%','%Não é Todo Mundo%','%Cliente Passando Cartão%']) order by t.title`,
  planChildren: `select l.parent_id,l.child_id,l.relation_kind,l.slot,l.position,l.workflow_step_id,l.status_override,p.title as parent_title,c.title as child_title,c.kind as child_kind,c.subtype as child_subtype,c.status as child_status from public.task_links l join public.tasks p on p.id=l.parent_id join public.tasks c on c.id=l.child_id where l.parent_id='7e1a162d-ff0f-414e-ad50-bea8b472fbcd' or l.parent_id in (select child_id from public.task_links where parent_id='7e1a162d-ff0f-414e-ad50-bea8b472fbcd') order by p.title,l.position`,
  people: `select id,full_name from public.profiles where full_name ilike any(array['%Luiza%','%Cintia%','%Allan%'])`,
  cycles: `select id,title,client_id,kind,status,due_date,plan_id,payload->>'recurrence_parent_id' as recurrence_parent_id,payload->>'occurrence_date' as occurrence_date,payload->>'recurrence_cycle' as recurrence_cycle,jsonb_array_length(coalesce(payload->'comments','[]'::jsonb)) as comment_count from public.tasks where payload->>'recurrence_parent_id'='71e87469-990b-416e-9d0e-a6f57e781343' order by due_date`,
  cycleLinks: `select l.parent_id,l.child_id,l.relation_kind,p.title as parent_title,c.title as child_title,c.client_id from public.task_links l join public.tasks p on p.id=l.parent_id join public.tasks c on c.id=l.child_id where l.parent_id in (select id from public.tasks where payload->>'recurrence_parent_id'='71e87469-990b-416e-9d0e-a6f57e781343') or l.parent_id='71e87469-990b-416e-9d0e-a6f57e781343' order by l.parent_id,l.position`,
  stepSlots: `select v.id as workflow_id,v.label,v.version,s.id as step_id,s.step_key,s.order_index,tt.key as task_type from public.workflow_versions v join public.workflow_version_steps s on s.workflow_version_id=v.id join public.task_types tt on tt.id=s.task_type_id where v.id='5a2d8330-86a7-4853-b6d9-d04e5c0cedcd' order by s.order_index`,
  planComments: `select id,title,payload->'comments' as comments from public.tasks where id in ('7e1a162d-ff0f-414e-ad50-bea8b472fbcd','0f18c00f-69b6-4c94-9223-4284fe67dea4','eae097f0-b30e-4a4b-ad36-3a6a8d22d18a','71e87469-990b-416e-9d0e-a6f57e781343')`,
  taskIndexes: `select indexname,indexdef from pg_indexes where schemaname='public' and tablename in ('tasks','task_links') order by tablename,indexname`,
  taskTriggers: `select tgname,pg_get_triggerdef(oid) as definition from pg_trigger where tgrelid in ('public.tasks'::regclass,'public.task_links'::regclass) and not tgisinternal order by tgrelid::regclass::text,tgname`,
  pieceSteps: `select p.id as delivery_id,p.title as delivery,l.child_id,c.title as step_title,c.subtype,c.status,c.completed_at,c.reviewer_id,l.status_override,l.completed_at_override from public.task_links l join public.tasks p on p.id=l.parent_id join public.tasks c on c.id=l.child_id where p.id in (select child_id from public.task_links where parent_id='7e1a162d-ff0f-414e-ad50-bea8b472fbcd') and l.relation_kind='workflow_step' order by p.title,l.position`,
  workspaces: `select creative_task_id,stage_task_id,raw_folder_id from public.drive_creative_workspaces where creative_task_id in (select child_id from public.task_links where parent_id='7e1a162d-ff0f-414e-ad50-bea8b472fbcd')`,
  captureWorkspaces: `select capture_task_id,capture_folder_id,script_folder_id from public.drive_capture_workspaces where capture_task_id in ('0f18c00f-69b6-4c94-9223-4284fe67dea4','eae097f0-b30e-4a4b-ad36-3a6a8d22d18a')`,
  targetComments: `select t.id,t.title,c.value->>'id' as comment_id,left(c.value->>'text',120) as text,c.value->>'at' as at,c.value->>'author' as author from public.tasks t cross join lateral jsonb_array_elements(coalesce(t.payload->'comments','[]'::jsonb)) c where t.id in ('8393b20d-81e3-4b9d-8731-750bc3fb0ae3','d9f87cf5-3437-4797-98cf-44818d03ffa2','0f18c00f-69b6-4c94-9223-4284fe67dea4') order by t.title,c.value->>'at'`,
  routineFunctions: `select proname,pg_get_functiondef(oid) as definition from pg_proc where oid in ('public.tasks_project_task_type()'::regprocedure,'public.validate_task_link()'::regprocedure,'public.structural_link_has_no_cycle()'::regprocedure,'public.workflow_link_is_strictly_sequential()'::regprocedure)`,
  publications: `select t.id,t.title,t.subtype,t.status,t.client_id,t.payload from public.tasks t where t.subtype='publicacao' and (t.title ilike any(array['%Cliente Passando Cartão%','%Promoções da Semana%','%Não é Todo Mundo%','%Paz de Espírito%','%Divulgação Evento%','%Dicas para Aproveitar%','%Anúncio —%','%Equilibrando a bebida%'])) order by title`,
  publicationTypes: `select t.id,t.task_type_id,t.subtype,t.title from public.tasks t where t.id in ('3b7372e1-4359-4ac5-971b-15757838d915','68bf6f30-8c67-402d-9a6b-48479cc00980','1778f2a8-8ac1-4e28-8ef4-2b1f013c457e','7938fdf1-6775-48ce-bedb-1a6d9c9eb3cb','79498d2b-f87b-4b99-ac49-141e5207de03','369ba3c0-20d7-482d-a043-8286123ee698','fa6e8424-a821-48af-891f-95011fe5bd7e','63dc6a3c-a0e3-458c-9b04-83ff8dfbc67d')`,
  invalidRecurrences: `select t.id,t.title,t.client_id,t.plan_id,p.client_id as parent_client_id from public.tasks t join public.tasks p on p.id=t.plan_id where t.payload->>'recurrence_parent_id'=p.id::text and t.client_id is distinct from p.client_id`,
  allCrossClientPlanIds: `select t.id,t.client_id,t.plan_id,p.client_id as parent_client_id from public.tasks t join public.tasks p on p.id=t.plan_id where t.client_id is distinct from p.client_id`,
  assignees: `select a.task_id,a.profile_id,p.full_name from public.task_assignees a join public.profiles p on p.id=a.profile_id where a.task_id in ('8393b20d-81e3-4b9d-8731-750bc3fb0ae3','d9f87cf5-3437-4797-98cf-44818d03ffa2','9c92e5be-fee6-5e65-910a-aed5ee814fc8')`,
};
await db.connect();
try {
  const wanted = new Set(process.argv.slice(2));
  for (const [name, query] of Object.entries(sections)) {
    if (wanted.size && !wanted.has(name)) continue;
    const { rows } = await db.query(query);
    console.log(JSON.stringify({ section: name, rows }));
  }
} finally {
  await db.end();
}
