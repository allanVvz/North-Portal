-- Reviewer field on tasks: a task can be assigned a reviewer (any existing
-- profile — admin or the task's own client). Simple mutable column, no
-- history/audit table by design (per product decision — keep it simple).
alter table public.tasks
  add column if not exists reviewer_id uuid references public.profiles(id) on delete set null;

create index if not exists tasks_reviewer_id_idx on public.tasks (reviewer_id);
