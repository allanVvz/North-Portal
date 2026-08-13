# Reprodução e deploy — North Portal

Este é o runbook canônico para reconstruir o North Portal com um projeto Supabase Cloud e publicá-lo pela integração GitHub → Vercel. O Git contém o código, migrations, RLS, scripts e um seed demonstrativo sanitizado. Usuários, segredos, estado do banco e dados de produção permanecem externos.

## 1. Pré-requisitos

- Node.js 20 LTS ou mais recente e npm;
- Git;
- um projeto Supabase Cloud e permissão para vinculá-lo pela CLI;
- acesso ao projeto Vercel e à integração do repositório no GitHub;
- para execução não interativa da CLI: access token e senha do banco Supabase.

A Supabase CLI está fixada em `devDependencies`; não é necessário instalá-la globalmente.

## 2. Variáveis e Auth

Copie `.env.example` para `.env.local` e preencha localmente. Nunca envie esse arquivo ao Git.

| Variável | Escopo | Natureza |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | app/Vercel | URL pública do projeto |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | app/Vercel | chave pública anon/publishable |
| `SUPABASE_SERVICE_ROLE_KEY` | servidor/Vercel | segredo; nunca usar no cliente |
| `SUPABASE_PROJECT_REF` | operação local | ref de 20 caracteres usada pela CLI |
| `SUPABASE_ACCESS_TOKEN` | operação local/CI manual | segredo opcional se a CLI já estiver autenticada |
| `SUPABASE_DB_PASSWORD` | operação local/CI manual | segredo necessário quando a CLI pedir a senha |
| `DEMO_*` | criação dos logins demo | e-mails e senhas temporários, nunca versionados |

Valide sem imprimir valores:

```bash
npm run env:check
npm run env:check:cloud
```

No Supabase Dashboard, em **Authentication → URL Configuration**, configure:

- Site URL: a URL canônica de produção;
- Redirect URLs: `http://localhost:3000/**`, o domínio de produção e os domínios de Preview autorizados.

O app deriva o redirect de recuperação de senha da origem atual. Portanto, cada origem utilizada precisa estar permitida no Supabase Auth.

## 3. Instalação e banco

Em uma instalação limpa:

```bash
npm ci
npm run env:check:cloud
npm run db:migrate
npm run db:seed
```

`db:migrate` executa `supabase link --project-ref` e depois `supabase db push --linked`. As migrations são aplicadas na ordem lexical registrada em `supabase/migrations/`. `db:seed` repete o push com `--include-seed`; migrations já aplicadas são ignoradas e o `supabase/seed.sql` idempotente é executado.

Antes do primeiro push, autentique a CLI com `npx supabase login` ou forneça `SUPABASE_ACCESS_TOKEN`. A CLI pode pedir `SUPABASE_DB_PASSWORD`. Não passe segredos como argumentos de linha de comando e não habilite logs de debug em CI.

O seed cria apenas `north-demo`, `cliente-demo` e tarefas/conteúdo fictícios. Ele não reconstrói clientes ou dados reais.

## 4. Usuários de demonstração

Depois do seed, defina `DEMO_ADMIN_EMAIL`, `DEMO_ADMIN_PASSWORD`, `DEMO_CLIENT_EMAIL` e `DEMO_CLIENT_PASSWORD` no ambiente e execute:

```bash
npm run create:demo-users
```

O script cria ou atualiza dois usuários confirmados: um admin gerente e um cliente vinculado a `cliente-demo`. Os valores não são exibidos. Compartilhe credenciais apenas por canal seguro e remova as quatro variáveis após o uso.

## 5. Validação local

```bash
npm run check:deploy
npm run dev
```

`check:deploy` valida as três variáveis do runtime sem mostrá-las, rejeita caminhos/segredos conhecidos versionados e roda typecheck, testes e build. O E2E real é opt-in porque cria dados temporários e requer usuários cloud:

```bash
npm run test:e2e
```

Confirme manualmente:

- `/` responde e a navegação pública carrega;
- `/login` permite login do admin demo e do cliente demo;
- `/admin` deslogado redireciona para `/login` e um cliente não ganha acesso;
- o admin acessa `/admin` e o cliente acessa `/cliente-demo`;
- APIs protegidas rejeitam sessão ausente/papel incorreto;
- o cliente não lê nem altera registros de outro cliente (RLS).

## 6. CI e deploy Vercel

`.github/workflows/ci.yml` roda `npm ci`, verificação do repositório, typecheck, testes e build em pull requests e pushes na `main`. Qualquer falha bloqueia o check.

O deploy não é feito por script deste repositório. A integração existente **GitHub → Vercel** publica Preview para branches/PRs e Production para a `main`, deixando cada build rastreável ao commit. No projeto Vercel, configure exatamente estas três variáveis nos ambientes **Production**, **Preview** e **Development**:

- `NEXT_PUBLIC_SUPABASE_URL`;
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`;
- `SUPABASE_SERVICE_ROLE_KEY` (marcada como Sensitive).

Não configure `SUPABASE_PROJECT_REF`, credenciais da CLI ou credenciais demo na Vercel.

## 7. Checklist pós-deploy

- [ ] o build da Vercel está verde e associado ao SHA esperado;
- [ ] `GET /` responde sem erro;
- [ ] `/login` abre e autentica um usuário real de teste;
- [ ] `/admin` mantém o gate para deslogado e cliente;
- [ ] admin e cliente chegam aos destinos corretos depois do login;
- [ ] uma API admin e uma API cliente rejeitam acesso indevido;
- [ ] leitura/escrita de teste respeita a RLS e o isolamento por cliente;
- [ ] logs de GitHub, Vercel e Supabase não contêm chaves ou senhas.

## 8. Rollback operacional

1. Pare promoções e identifique o commit e a migration que introduziram a falha.
2. Para falha somente no app, use o rollback/redeploy da Vercel para o último deployment saudável e confirme novamente `/`, `/login` e os gates.
3. Para falha de banco, não use `db reset`, não edite uma migration já aplicada e não restaure produção por cima sem aprovação. Crie uma migration compensatória, teste-a em outro projeto/branch e aplique com `npm run db:migrate`.
4. Se houve perda/corrupção de dados, restaure pelo mecanismo de backup/PITR disponível no plano Supabase e coordene a janela antes de reabrir escrita.
5. Registre SHA, migrations aplicadas, deployment restaurado e validações executadas.

Remover o seed demo é uma ação separada e destrutiva: exclua apenas os usuários demo pelo painel/Auth Admin e os clientes com slugs `north-demo` e `cliente-demo` após confirmar o alvo. As FKs removem os filhos; nunca generalize essa exclusão para dados reais.

## Limites do pacote

- Migrations e políticas RLS estão no Git; histórico remoto, Auth, segredos e dados não estão.
- `.env.local`, `.vercel/`, dumps, backups e exportações de produção são ignorados e proibidos no pacote.
- O seed é demonstrativo. E2E contra dados reais continua manual/opt-in.
