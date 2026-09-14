-- Identidade visual de um tipo de topo (ícone/tom), pra permitir criar um
-- tipo-entrega novo (reels, carrossel, automação...) inteiramente pela tela
-- "Configurações › Tipos e fluxos", sem depender de uma entrada em código em
-- lib/taskCatalog.ts. Só faz sentido em linha de topo (parent_id is null) —
-- uma etapa não tem ícone/tom próprio, herda o do tipo.
--
-- `tone` é restrito às 5 tonalidades que já existem no design system
-- (--a-teal/-purple/-blue/-gold/-neutral em app/globals.css), pra nunca
-- precisar de um token de cor novo.
alter table public.task_types
  add column icon text,
  add column tone text check (tone in ('green', 'gold', 'blue', 'purple', 'neutral')),
  add column show_in_performance boolean not null default true;
