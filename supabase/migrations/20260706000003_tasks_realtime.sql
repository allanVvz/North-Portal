-- Enables Realtime (postgres_changes) on tasks so the admin Kanban and the
-- client Feedbacks page stay in sync live. Broadcast eligibility per
-- subscriber is still governed by the existing RLS SELECT policies (admin
-- sees everything, a client session only its own client_visible rows).
alter table public.tasks replica identity full;
alter publication supabase_realtime add table public.tasks;
