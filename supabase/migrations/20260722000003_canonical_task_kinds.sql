-- Recurrence is an orthogonal task attribute, never a task kind.
-- Roteiro and gravação are specializations of existing primary kinds.
-- Keep subtype values already chosen by users; only fill the canonical default.

update public.tasks
set kind = 'criativo'
where kind = 'publicacao_recorrente';

update public.tasks
set kind = 'planejamento',
    subtype = coalesce(subtype, 'roteiro')
where kind = 'roteiro';

update public.tasks
set kind = 'agendamento',
    subtype = coalesce(subtype, 'gravacao')
where kind = 'gravacao';
