-- Platform-wide master switch for the "Visível para o cliente" toggle used
-- throughout the Plano de Ação / Kanban. When disabled, every per-task
-- client_visible flag is treated as off across the whole platform (enforced
-- in getPortalPayload, not just the UI) — same site_settings key/value
-- pattern already used for the 'agency' profile.

insert into public.site_settings (key, value)
values ('plano_acao_visibility', '{"enabled": true}'::jsonb)
on conflict (key) do nothing;
