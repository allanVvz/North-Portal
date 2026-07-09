-- Tasks can now be created without a client ("Outros" filter in the admin
-- Kanban) — e.g. drafting a card before deciding which client it belongs to.
-- Safe for RLS as-is: every client-role policy on tasks checks
-- `client_id = current_client_id()`, and NULL never equals a UUID in SQL, so
-- unassigned rows stay invisible to every client session without any policy
-- changes. Only the "tasks admin all" (is_admin()) policy can see them.
alter table public.tasks alter column client_id drop not null;
