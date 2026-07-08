-- Demo seed: validated clients + their briefing/links/results + sample tasks.
-- Auth users (admin + client logins) are created separately via:
--   npm run create:user -- admin@north.com "Senha123!" admin
--   npm run create:user -- cliente@karpinski.com "Senha123!" client karpinski
-- Run this AFTER the migrations. Safe to re-run (idempotent).

-- ---- clients ----
insert into public.clients (slug, name, is_active) values
  ('north', 'ADM NORTH', true),
  ('karpinski', 'Karpinski Detalhamento', true),
  ('baita-conveniencia', 'Baita Conveniencia', true)
on conflict (slug) do update set name = excluded.name, is_active = true;

-- ---- one empty child row per client (briefing/links/results) ----
insert into public.briefing_answers (client_id)
  select id from public.clients on conflict (client_id) do nothing;
insert into public.client_drive_links (client_id)
  select id from public.clients on conflict (client_id) do nothing;
insert into public.client_results (client_id)
  select id from public.clients on conflict (client_id) do nothing;

-- ---- Karpinski briefing (per-question keys: <card>_q<n>) ----
update public.briefing_answers set answers = jsonb_build_object(
  'b1_historia_q1', 'A Karpinski comecou em 2019 como uma garagem de detailing.',
  'b1_historia_q2', 'Atua ha cerca de 6 anos no mercado.',
  'b2_metas_q1', 'Aumentar orcamentos qualificados via Direct.',
  'b7_midia_q1', 'Orcamento inicial de R$ 900/mes.'
), submitted = false
where client_id = (select id from public.clients where slug = 'karpinski');

-- ---- Karpinski links + results ----
update public.client_drive_links set
  brand_url = 'https://drive.google.com/drive/folders/DEMO-marca-karpinski',
  products_url = 'https://drive.google.com/drive/folders/DEMO-servicos-karpinski',
  uploads_url = 'https://drive.google.com/drive/folders/DEMO-uploads-karpinski'
where client_id = (select id from public.clients where slug = 'karpinski');

update public.client_results set
  top_metrics = '[
    {"label":"Orcamentos no Direct","value":"63","variation":"+41%","description":"Ultimos 30 dias"},
    {"label":"Alcance","value":"48,2 mil","variation":"+12%","description":"Contas alcancadas"},
    {"label":"Custo por lead","value":"R$ 7,80","variation":"-23%","description":"Meta Ads"},
    {"label":"Agendamentos","value":"29","variation":"+18%","description":"Vitrificacao/polimento"}
  ]'::jsonb,
  insights = '[
    {"title":"Stories de bastidor convertem mais","description":"Sequencias mostrando o processo geraram 2x mais DMs.","category":"Conteudo","date":"2026-06-28"}
  ]'::jsonb,
  report_url = 'https://drive.google.com/file/d/DEMO-relatorio-karpinski',
  feedback_url = 'https://forms.gle/DEMO-feedback-karpinski'
where client_id = (select id from public.clients where slug = 'karpinski');

-- ---- sample tasks for Karpinski ----
insert into public.tasks (client_id, type, title, status, priority, assignee, due_date, client_visible, description)
select c.id, t.type::public.task_type, t.title, t.status::public.task_status, t.priority::public.task_priority,
       t.assignee, t.due_date::date, t.client_visible, t.description
from public.clients c
cross join (values
  ('criativo','Capas de Reels - Lancamento delivery','revisao','alta','Ana', '2026-07-08', true, 'Serie de 3 capas para o lancamento.'),
  ('agendamento','Campanha de delivery - Junho','aprovacao','media','Marcos', '2026-07-03', false, 'Aprovar copy e segmentacao internamente antes de mandar ao cliente.'),
  ('criativo','Estruturar pastas no Google Drive','aprovacao','baixa','Ana', '2026-07-04', true, 'Aguardando aprovacao do cliente.'),
  ('desempenho','Relatorio mensal','em_producao','media','North', '2026-07-15', false, 'Consolidar metricas do mes.'),
  ('criativo','Reels de bastidor - vitrificacao','revisao','media','Ana', '2026-07-10', true, 'Revisor validando corte e legenda antes de mandar para aprovacao.'),
  ('agendamento','Post de aniversario da loja','aprovado','baixa','Marcos', '2026-07-05', true, 'Aprovado pelo cliente, aguardando data de publicacao.')
) as t(type, title, status, priority, assignee, due_date, client_visible, description)
where c.slug = 'karpinski'
on conflict do nothing;
