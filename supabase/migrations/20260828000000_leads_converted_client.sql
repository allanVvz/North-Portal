-- Liga um lead ao cliente que ele virou.
--
-- O status 'convertido' já existia no enum de public.leads desde 20260815, mas
-- não havia como saber em QUAL cliente o lead virou — o status sozinho é um
-- rótulo sem destino. Esta coluna é também a chave que um CRM vai usar para
-- reconciliar os dois lados quando a integração existir.
--
-- ON DELETE SET NULL, não CASCADE: apagar um cliente não pode apagar o
-- registro do formulário que a pessoa preencheu. O lead é histórico de
-- captação e sobrevive ao cliente.
alter table public.leads
  add column if not exists converted_client_id uuid references public.clients(id) on delete set null;

create index if not exists leads_converted_client_id_idx
  on public.leads (converted_client_id)
  where converted_client_id is not null;
