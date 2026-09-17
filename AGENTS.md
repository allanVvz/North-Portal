# Operação de produção

- A infraestrutura ativa deste repositório é **Vercel + Supabase Cloud**;
  não há VPS self-hosted em uso. Quando uma solicitação mencionar “VPS”,
  confirme o alvo e, para mudanças de dados, trate-o como o banco Supabase de
  produção `rqwycltgnnvaunvmyxea` enquanto não houver outro host documentado.
- Produção é o único ambiente disponível para validação integrada. Não inferir
  que exista preview, staging ou banco descartável.
- Antes de DDL ou DML em produção: registrar o estado do schema e do ledger,
  executar preflight não mutante e preservar um caminho de rollback. Nunca
  usar `db reset` em produção.
- O ledger local e remoto de migrations está divergente. Não executar
  `supabase db push` nem `migration repair` automaticamente. Aplicações
  aprovadas devem usar SQL versionado, com a migration correspondente no
  repositório, e atualizar o ledger somente após equivalência de schema ser
  comprovada.
- Quando o MCP Supabase negar `execute_sql`/`apply_migration` e o CLI falhar
  com `Transport error` na Management API, o fallback é a conexão Postgres
  direta configurada somente em `.env.local` como `SUPABASE_DB_URL`. Ela deve
  ser uma URI do **Session pooler**; nunca usar `SUPABASE_SERVICE_ROLE_KEY`
  para DDL e nunca registrar, imprimir ou enviar URI, senha ou PAT.
- Runbook de migration direta: (1) executar um preflight de leitura, incluindo
  slots inválidos, cardinalidade e ledger; (2) aplicar o arquivo SQL versionado
  em uma única transação com rollback em qualquer falha; (3) confirmar no
  catálogo a coluna/constraint/índice/trigger e os dados esperados; (4) só
  então inserir o registro mínimo correspondente no ledger remoto; (5) rodar
  E2E autenticado contra `https://northportal.vercel.app`. Não substituir esse
  fluxo por `db push` ou `migration repair`.
- Esta máquina pode apresentar `self-signed certificate in certificate chain`
  ao cliente Postgres/Node, embora `curl -4` alcance a API do Supabase. A
  correção padrão é confiar na CA corporativa/local (`NODE_EXTRA_CA_CERTS` ou
  equivalente). Nunca dispensar validação de certificado por padrão; isso só
  pode ocorrer em uma execução específica com autorização explícita do usuário.
- E2E que usa Supabase REST nesta rede deve iniciar Node com
  `NODE_OPTIONS=--use-system-ca`. O teste `e2e/task-modal-navigation-context.spec.ts`
  cria um card temporário e o remove no `afterAll`; `e2e/auth-login.spec.ts`
  é somente leitura para dados de operação.
- A publicação da aplicação ocorre por GitHub -> Vercel quando `main` recebe
  um push; não executar um deploy manual redundante após esse push.
