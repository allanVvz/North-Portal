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

# Diária recorrente da BAITA

- Em 26/09/2026, a BAITA é a única automação `diaria_recorrente` configurada
  em produção. Não transformar contratos ou checkpoints de outros clientes em
  diárias por inferência.
- A automação ativa usa o Plano recorrente
  `17df6360-1757-4afe-b9ef-96bbe368ae25`, mensal no dia 16. O primeiro ciclo
  é `24c4dcd3-5b8a-5347-9106-89ce48391dd2`, em 16/10/2026. Cada ciclo
  prevê 8 Reels, 2 Carrosséis e 2 Anúncios, com prazo de 7 dias após a
  gravação. A configuração é `cd387708-2aa5-4d2c-b2ac-dd22d33cd340`.
- O Plano histórico de setembro/outubro
  `7e1a162d-ff0f-414e-ad50-bea8b472fbcd` serve apenas de referência
  visual: seus cards e arquivos não são movidos nem recriados nos ciclos.
- A diária tem um Google Doc canônico para todos os ciclos, no qual a
  roteirista acrescenta páginas por gravação. O Doc da BAITA é
  `19UqWyrg4XoXw6udH6hoFUax21C6utER0VNZ2gMjG_Cw`, na pasta geral
  `1y1E_M4h14s_nC73SI20WHtcFM3MzmEMC`. Cada ciclo recebe um atalho para
  esse Doc na própria pasta de Roteiro; Roteiro e Captação são compartilhados
  pelas Entregas daquele ciclo.
- A preparação do primeiro ciclo foi executada duas vezes em produção e
  permaneceu idempotente: um ciclo, 12 Entregas, um Roteiro, uma Captação,
  12 workspaces de Criativo e um workspace de Captação. Os comentários
  automáticos foram gravados sem duplicação. Links de comentário para Doc e
  pastas de Roteiro/Captação foram verificados pela API autenticada; o link do
  Doc abriu o modal de materiais com a fonte Roteiro selecionada.
- A integração do aplicativo usa uma conta de serviço do Google Drive. Ela
  recebeu `storageQuotaExceeded` ao tentar criar um Google Doc no Meu Drive
  da BAITA. O Doc atual foi criado por uma conta pessoal com acesso e depois
  vinculado à automação. Para criar Docs automaticamente em outros clientes,
  usar um Drive compartilhado ou integrar uma conta humana ao aplicativo;
  em pastas do Meu Drive, vincular um Doc criado por uma pessoa.
- O E2E visual autenticado `e2e/daily-automation-visual.spec.ts` inspeciona
  a configuração existente em desktop e tela estreita sem criar uma segunda
  automação. Antes de mudar dados da BAITA, preservar o preflight e o fluxo
  de migration/rollback descritos acima.
