# Operação do repositório

- Produção usa Vercel e Supabase Cloud (`rqwycltgnnvaunvmyxea`). Não há VPS, preview, staging ou banco descartável documentado. Confirme o alvo quando houver ambiguidade.
- Antes de alterar dados ou schema em produção, faça preflight de leitura, registre schema e ledger, prepare rollback e use SQL versionado em transação. Confira a equivalência após aplicar; só então atualize o ledger remoto.
- O ledger local e remoto diverge. Nunca use `supabase db push`, `migration repair` ou `db reset` em produção.
- Se MCP/CLI falharem, a conexão Postgres direta é `SUPABASE_DB_URL` em `.env.local`, via Session pooler. Não exponha credenciais nem desative a validação de certificado. Para E2E nesta rede, use `NODE_OPTIONS=--use-system-ca`.
- Valide mudanças integradas com E2E autenticado em `https://northportal.vercel.app`. O push para `main` publica via GitHub → Vercel; não faça deploy manual redundante.
- Registre estados específicos de clientes e handoffs em `memory.md`, que é local e ignorado pelo Git. Mantenha este arquivo apenas com regras gerais.
