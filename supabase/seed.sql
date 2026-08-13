-- Sanitized, idempotent demonstration data only.
-- No production exports, real credentials, real users, or customer data belong here.
-- Auth users are created separately with `npm run create:demo-users`.

insert into public.clients (slug, name, is_active) values
  ('north-demo', 'North Demo', true),
  ('cliente-demo', 'Cliente Exemplo', true)
on conflict (slug) do update set name = excluded.name, is_active = excluded.is_active;

insert into public.briefing_answers (client_id)
select id from public.clients where slug in ('north-demo', 'cliente-demo')
on conflict (client_id) do nothing;
insert into public.client_drive_links (client_id)
select id from public.clients where slug in ('north-demo', 'cliente-demo')
on conflict (client_id) do nothing;
insert into public.client_results (client_id)
select id from public.clients where slug in ('north-demo', 'cliente-demo')
on conflict (client_id) do nothing;

insert into public.briefing_answers (client_id, answers, submitted)
select id, jsonb_build_object(
  'b1_historia_q1', 'Empresa demonstrativa criada para validar o portal.',
  'b2_metas_q1', 'Receber contatos qualificados pelos canais digitais.',
  'b7_midia_q1', 'Orcamento ficticio para fins de demonstracao.'
), false
from public.clients where slug = 'cliente-demo'
on conflict (client_id) do update
set answers = excluded.answers, submitted = excluded.submitted;

insert into public.client_drive_links (client_id, brand_url, products_url, uploads_url)
select id,
  'https://example.com/demo/marca',
  'https://example.com/demo/produtos',
  'https://example.com/demo/uploads'
from public.clients where slug = 'cliente-demo'
on conflict (client_id) do update set
  brand_url = excluded.brand_url,
  products_url = excluded.products_url,
  uploads_url = excluded.uploads_url;

insert into public.client_results (client_id, top_metrics, insights, report_url, feedback_url)
select id,
  '[
    {"label":"Contatos","value":"24","variation":"+12%","description":"Dados ficticios"},
    {"label":"Alcance","value":"18 mil","variation":"+8%","description":"Dados ficticios"},
    {"label":"Custo por lead","value":"R$ 9,40","variation":"-5%","description":"Dados ficticios"},
    {"label":"Agendamentos","value":"11","variation":"+10%","description":"Dados ficticios"}
  ]'::jsonb,
  '[{"title":"Conteudo de bastidor","description":"Exemplo sanitizado de insight.","category":"Conteudo","date":"2026-08-01"}]'::jsonb,
  'https://example.com/demo/relatorio',
  'https://example.com/demo/feedback'
from public.clients where slug = 'cliente-demo'
on conflict (client_id) do update set
  top_metrics = excluded.top_metrics,
  insights = excluded.insights,
  report_url = excluded.report_url,
  feedback_url = excluded.feedback_url;

insert into public.tasks
  (id, client_id, kind, title, status, priority, assignee, due_date, client_visible, description, payload, position)
select t.id::uuid, c.id, t.kind, t.title, t.status::public.task_status,
  t.priority::public.task_priority, t.assignee, t.due_date::date,
  t.client_visible, t.description, '{"demo":true}'::jsonb, t.position
from public.clients c
cross join (values
  ('d0000000-0000-4000-8000-000000000001','criativo','Capas para campanha demonstrativa','revisao','alta','Equipe Demo','2026-08-12',true,'Peca ficticia para validar o fluxo de revisao.',10),
  ('d0000000-0000-4000-8000-000000000002','agendamento','Campanha de lancamento demonstrativa','aprovacao','media','Equipe Demo','2026-08-14',true,'Campanha ficticia aguardando aprovacao.',20),
  ('d0000000-0000-4000-8000-000000000003','operacional','Organizar materiais de demonstracao','em_producao','baixa','Equipe Demo','2026-08-16',false,'Tarefa interna ficticia.',30),
  ('d0000000-0000-4000-8000-000000000004','criativo','Video curto de bastidor','aprovado','media','Equipe Demo','2026-08-18',true,'Conteudo ficticio ja aprovado.',40)
) as t(id, kind, title, status, priority, assignee, due_date, client_visible, description, position)
where c.slug = 'cliente-demo'
on conflict (id) do update set
  client_id = excluded.client_id,
  kind = excluded.kind,
  title = excluded.title,
  status = excluded.status,
  priority = excluded.priority,
  assignee = excluded.assignee,
  due_date = excluded.due_date,
  client_visible = excluded.client_visible,
  description = excluded.description,
  payload = excluded.payload,
  position = excluded.position;
