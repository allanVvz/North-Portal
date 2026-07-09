-- Decouples the Kanban column's visibility from the admin/cliente flags: a
-- new independent toggle per stage (revisao_kanban / aprovacao_kanban)
-- controls only whether the board shows that column. admin/cliente keep
-- controlling revisor/aprovador assignment + the client-facing surfaces.
--
-- Also resets the "natural" default for every account (existing rows
-- included): Revisão/Aprovação start OFF for admin and cliente everywhere,
-- while the Kanban column stays visible — matching the product decision that
-- these stages are dormant by default until an admin explicitly turns them on
-- for a given client.

alter table public.client_flow_flags
  add column if not exists revisao_kanban boolean not null default true,
  add column if not exists aprovacao_kanban boolean not null default true;

update public.client_flow_flags set
  revisao_admin = false,
  revisao_cliente = false,
  revisao_kanban = true,
  aprovacao_admin = false,
  aprovacao_cliente = false,
  aprovacao_kanban = true;

alter table public.client_flow_flags
  alter column revisao_admin set default false,
  alter column revisao_cliente set default false,
  alter column aprovacao_admin set default false,
  alter column aprovacao_cliente set default false;
