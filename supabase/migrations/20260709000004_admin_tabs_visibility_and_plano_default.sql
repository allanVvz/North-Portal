-- Global (not per-client) switches for whether the admin sidebar shows the
-- "Revisões"/"Aprovações" nav items at all — independent of client_flow_flags,
-- which only gate per-client data/assignment. Off by default (these queues
-- are hidden by nature until an admin turns them on).
insert into public.site_settings (key, value)
values ('admin_tabs_visibility', '{"revisoesTabVisible": false, "aprovacoesTabVisible": false}'::jsonb)
on conflict (key) do update set value = excluded.value;

-- "Visível para o cliente" master switch also starts off by nature.
insert into public.site_settings (key, value)
values ('plano_acao_visibility', '{"enabled": false}'::jsonb)
on conflict (key) do update set value = excluded.value;
