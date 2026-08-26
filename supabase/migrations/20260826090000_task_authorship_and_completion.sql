-- Autoria e conclusão do card.
--
-- `tasks` guardava created_at mas não QUEM criou, então o card não conseguia
-- mostrar "criado por" — e não guardava QUANDO foi concluído, só o status
-- atual, o que tornava impossível ordenar por ordem de conclusão (a ordem
-- ficava caindo em updated_at, que qualquer edição posterior embaralha).
--
-- created_by referencia auth.users (não profiles) porque é o id que o servidor
-- já tem em mãos na criação, via getSession(). on delete set null: apagar um
-- admin não pode apagar o histórico dos cards que ele abriu.

alter table public.tasks
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists completed_at timestamptz;

-- Backfill: cards já em estado terminal ganham uma data de conclusão
-- plausível (a última vez que mudaram) em vez de ficarem nulos e sumirem do
-- fim da ordenação por conclusão.
update public.tasks
  set completed_at = updated_at
  where completed_at is null and status in ('concluido', 'aprovado');

-- Mantém completed_at coerente com o status sem depender da aplicação lembrar:
-- entrou em estado terminal, carimba; saiu, limpa.
create or replace function public.tasks_sync_completed_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status in ('concluido', 'aprovado') then
    if old.status is distinct from new.status or new.completed_at is null then
      new.completed_at := coalesce(new.completed_at, now());
    end if;
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_completed_at on public.tasks;
create trigger tasks_completed_at
  before insert or update on public.tasks
  for each row execute function public.tasks_sync_completed_at();

create index if not exists tasks_completed_at_idx on public.tasks (completed_at desc nulls last);
