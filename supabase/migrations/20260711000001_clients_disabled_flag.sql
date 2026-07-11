-- Soft-delete for clients: "Remover do sistema" just hides a client from
-- every picker/dropdown and from the Kanban (its cards too) instead of
-- actually deleting the row. Re-enabled via the "Desabilitado" filter in
-- the Clientes screen's search.
alter table public.clients add column if not exists disabled boolean not null default false;
