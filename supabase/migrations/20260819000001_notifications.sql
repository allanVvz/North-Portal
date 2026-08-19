-- Notifications: lightweight per-account inbox for the admin bell
-- (app/admin/AdminShell.tsx rail — wired to this table in a follow-up pass;
-- that dropdown ships first against hardcoded mock data). Two producers so
-- far, both keyed by (profile_id, task_id, type) via the unique index below
-- so a re-trigger REFRESHES the same row instead of piling up duplicates:
--
--   1. task_review_assigned — the trigger below, fires when a task's
--      reviewer_id is set while (or as it becomes) status = 'revisao'.
--      Resets created_at/read_at on conflict, since being made reviewer
--      again is a genuinely new event worth re-surfacing as unread.
--
--   2. task_due_soon — no cron/scheduled-job mechanism exists anywhere in
--      this repo yet, so this producer is intentionally NOT a scheduled job.
--      It's computed lazily by lib/notifications.ts's
--      upsertDueSoonNotifications, called from GET /api/admin/notifications
--      before reading. Smallest real slice for now; a real
--      cron/edge-function can replace the lazy computation later without
--      changing this table's shape. Its upsert only refreshes `message` on
--      conflict (see lib/notifications.ts), so marking one read sticks even
--      if the same task is still due soon on the next poll.
--
-- Mutable, no audit/history table — same "no audit trail by product
-- decision" precedent already applied to reviewer_id/approver_id and
-- task_assignees.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  type text not null,
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_profile_id_idx on public.notifications (profile_id);
create index if not exists notifications_profile_unread_idx
  on public.notifications (profile_id) where read_at is null;
-- Upsert target for both producers (see comment above).
create unique index if not exists notifications_profile_task_type_idx
  on public.notifications (profile_id, task_id, type);

-- Realtime, same idiom as tasks (20260706000003): admin dropdown can later
-- subscribe to postgres_changes on this table filtered by profile_id, the
-- same pattern lib/useTaskRealtime.ts already uses for tasks.
alter table public.notifications replica identity full;
alter publication supabase_realtime add table public.notifications;

alter table public.notifications enable row level security;

-- Recipient reads their own inbox; admin can read any (parallels
-- "profiles self read" / "clients read own or admin").
create policy "notifications read own or admin" on public.notifications
  for select to authenticated
  using (profile_id = auth.uid() or public.is_admin());

-- Recipient marks their own notifications read; admin can also update any —
-- required so the task_review_assigned trigger (which runs under the acting
-- admin's session, not the target reviewer's) can refresh a pre-existing
-- conflicting row for a DIFFERENT profile_id via ON CONFLICT DO UPDATE.
create policy "notifications update own or admin" on public.notifications
  for update to authenticated
  using (profile_id = auth.uid() or public.is_admin())
  with check (profile_id = auth.uid() or public.is_admin());

-- Only admin sessions ever produce notifications right now (the trigger only
-- fires from admin-gated task updates; the due-soon lazy upsert only runs
-- from the admin-only GET route).
create policy "notifications admin insert" on public.notifications
  for insert to authenticated with check (public.is_admin());

create policy "notifications admin delete" on public.notifications
  for delete to authenticated using (public.is_admin());

-- Trigger producer #1: reviewer assigned into (or re-assigned within) the
-- Revisão stage. security invoker (same convention as replace_task_assignees
-- /append_task_comment) — runs under the same session that performed the
-- tasks UPDATE, which is always an admin per "tasks admin all" RLS, so
-- is_admin() holds for the insert/update above regardless of who the
-- notification's target profile_id is.
create or replace function public.notify_task_reviewer_assigned()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.status = 'revisao' and new.reviewer_id is not null
     and (old.status is distinct from new.status or old.reviewer_id is distinct from new.reviewer_id) then
    insert into public.notifications (profile_id, task_id, type, message)
    values (new.reviewer_id, new.id, 'task_review_assigned', 'Revisão atribuída: "' || new.title || '".')
    on conflict (profile_id, task_id, type) do update
      set message = excluded.message, created_at = now(), read_at = null;
  end if;
  return new;
end $$;

drop trigger if exists notify_task_reviewer_assigned on public.tasks;
create trigger notify_task_reviewer_assigned
  after update on public.tasks
  for each row execute function public.notify_task_reviewer_assigned();
