-- Trello list "KARPINSKI" and portal client "Karpinski Detalhamento" are the
-- same client, but the board showed them as two, so a client's routines were
-- split across two columns and two filter entries.
--
-- The mapping is explicit rather than matched by normalized name: fuzzy naming
-- would also match a future "Karpinski Engenharia" and silently merge two
-- clients' routines. A silent wrong merge is worse than visible duplication.
-- Name matching stays only as an auto-suggestion when filling this field in.
alter table public.clients
  add column if not exists trello_list_id text;

create unique index if not exists clients_trello_list_id_unique_idx
  on public.clients (trello_list_id)
  where trello_list_id is not null;
