-- New Kanban stage between "Aprovação" and "Publicado": once a card is
-- approved (by the client on their own "aprovacao" card, or by the admin on
-- an internal one), it now lands on "Concluído" instead of jumping straight
-- to "Publicado" (concluido) — that final stage stays manual/drag-only.
alter type public.task_status add value if not exists 'aprovado' after 'aprovacao';
