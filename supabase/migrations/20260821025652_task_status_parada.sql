-- New Kanban status: "Parada" — a lateral halt state reachable from any
-- status (not a funnel step), used when an automation run fails and needs
-- human attention (see plan/AUTOMACOES-RELATORIO-TRAFEGO.md "Novo status
-- parada"). Valid for every task kind. Standalone migration (like
-- 20260706000002_task_aprovado_status.sql) — ALTER TYPE ... ADD VALUE cannot
-- share a transaction with statements that use the new value yet.
alter type public.task_status add value if not exists 'parada';
