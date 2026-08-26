-- Repõe o alvo da FK de created_by: auth.users -> public.profiles.
--
-- O id é o mesmo (profiles.id referencia auth.users), mas PostgREST só embeda
-- por FK declarada, e auth.users não é embedável pela API. Apontando para
-- profiles, a query do card resolve o nome do autor num join só
-- (`created_by_profile:profiles!tasks_created_by_fkey(full_name)`) em vez de
-- exigir uma segunda ida ao banco para traduzir uuid -> nome.

alter table public.tasks
  drop constraint if exists tasks_created_by_fkey;

alter table public.tasks
  add constraint tasks_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;
