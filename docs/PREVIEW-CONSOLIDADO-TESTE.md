# Preview consolidado: site público redesenhado + captura de leads

Branch: `preview/site-leads-consolidado` (criada a partir de `main` em 2026-08-26).

Consolida duas branches WIP de 19/08/2026 que ainda não tinham sido enviadas ao
GitHub nem mergeadas em `main`:

- `feat/leads-publicos` (`88e8311`) — API pública de captura de leads.
- `feat/site-publico` (`bd26b71`) — redesign do site público (home nova, planos,
  quem-somos, páginas legais, SEO, banner de consentimento, formulário de lead).

Uma terceira branch, `feat/documentos-storage`, foi **deliberadamente deixada de
fora** — ver seção final.

## Antes de testar

1. Instale dependências (`npm install`) e configure `.env.local` a partir do
   `.env.example` atualizado. Três variáveis novas entraram com este merge:
   - `NEXT_PUBLIC_GA4_ID` — opcional; sem ela o GA4 simplesmente não carrega
     mesmo com consentimento aceito.
   - `NEXT_PUBLIC_SITE_URL` — usada por `sitemap.xml`, `robots.txt` e pela
     imagem de Open Graph para montar URLs absolutas. Em local pode ficar
     `http://localhost:3000`.
   - `WHATSAPP_BUSINESS_NUMBER` — **obrigatória** para o formulário de lead
     funcionar de ponta a ponta (só dígitos, com DDI, ex: `5511999999999`).
     Sem ela a submissão do lead falha com 503 (`WhatsApp não configurado`),
     mesmo que o registro em si tenha sido validado.
2. Aplique a migration nova do banco: `supabase/migrations/20260815000001_public_leads.sql`
   (cria a tabela `public.leads` com RLS — só `authenticated` com
   `app_metadata.role = admin` lê/atualiza; a inserção do formulário público
   usa a service role via `createAdminClient()`, então não depende de policy
   de `insert` para `anon`). Rode a migration com o fluxo já usado no repo
   (`npm run db:migrate` ou aplicando direto no projeto Supabase de preview).
3. Suba o servidor local (`npm run dev`) ou um preview deploy.

## Rotas para testar

### `/` — inalterada (confirmar que continua igual)
A home pública atual em produção **não foi tocada** por este merge — ela
continua sendo a versão com o carrossel de slides (`Sua operação com
clareza`, `Marketing que vira referência`, etc.). Abra `/` e confirme que o
conteúdo é o mesmo de produção hoje. O que muda ao redor dela (herdado do
redesign, ver abaixo) é o `SiteFrame` compartilhado: menu mobile ("Abrir
menu" / `aria-label="Navegação principal"`), rodapé e o banner de
consentimento de cookies — esses componentes são globais a todo o site
público e passam a valer também para `/`.

- Teste o banner de cookies: na primeira visita (sem `localStorage` de
  `north-cookie-consent`) ele deve aparecer; clicar em "Somente essenciais"
  não deve carregar nenhum `<script data-north-ga>`; clicar em "Aceitar
  analytics" deve carregar o GA4 (se `NEXT_PUBLIC_GA4_ID` estiver setado).
- Teste o menu mobile (viewport estreito): botão "Abrir menu" abre a
  navegação, os links (Como funciona, Planos, Quem somos) navegam
  corretamente.

### `/lp` — a home redesenhada (nova rota, ainda não é a home oficial)
Esta é a página que a branch `feat/site-publico` trazia como substituta de
`/`. Por decisão deste merge, ela **não substituiu** a home em produção —
foi movida para `/lp` como preview isolado, para ser avaliada antes de uma
eventual troca. Rota pública (liberada em `middleware.ts`, não exige login).

Verificar:
- Hero novo ("Mais que presença. Direção para crescer.") com CTA "Solicitar
  diagnóstico" e demo ilustrativa do Portal North.
- Seções de método, cases (Baita / Chris Car Care / Aurora), oferta em 4
  frentes, FAQ.
- Formulário de lead na seção `#diagnostico` (rolar até o fim ou acessar
  `/lp#diagnostico` direto):
  - Etapa 1: Nome, Empresa, WhatsApp — validação client-side (tentar
    "Continuar" vazio deve mostrar um alerta/erro).
  - Etapa 2: Segmento, Cidade ou região, Principal objetivo, Faixa de
    investimento mensal.
  - Ao enviar ("Enviar e abrir…"), a página deve:
    1. Persistir o lead via `POST /api/leads` (checar no Supabase que a
       linha caiu em `public.leads`).
    2. Redirecionar para `https://wa.me/...` com o número configurado em
       `WHATSAPP_BUSINESS_NUMBER` e uma mensagem pré-preenchida com nome,
       empresa, segmento, região e objetivo.
  - Testar o honeypot: o campo oculto `website` não deve ser preenchível por
    um usuário real; se vier preenchido (simulação de bot via devtools), a
    API retorna 400 sem persistir.
  - Testar rate limit: mais de 5 submissões do mesmo IP em 10 minutos devem
    retornar 429 (`Muitas tentativas...`).

### `/planos` — redesenhada
Grade de planos/parceria reescrita (o arquivo antigo `PlanosGrid.tsx` foi
removido e o conteúdo incorporado direto em `page.tsx`). Conferir que os
cards de plano renderizam e que os links de CTA levam para `/lp#diagnostico`
ou WhatsApp conforme o caso.

### `/quem-somos` — redesenhada
Conferir texto institucional novo e que o layout usa o mesmo `SiteFrame`
(menu, rodapé, consentimento) das outras páginas.

### `/como-funciona`, `/politica-de-privacidade`, `/termos-de-uso`,
`/politica-de-cookies` — redesenhadas
Páginas legais e explicativas usando o componente `LegalView` atualizado.
Conferir que o conteúdo carrega e que a navegação entre elas funciona pelo
rodapé/menu.

### SEO técnico (novo)
- `/sitemap.xml` deve listar as rotas públicas (nota: **não inclui `/lp`**
  de propósito, já que é uma rota de preview, não a home oficial).
- `/robots.txt` deve permitir tudo exceto `/admin/`, `/api/`, `/login`,
  `/recuperar-senha`.
- `/opengraph-image` deve gerar uma imagem OG (1200x630) com o texto "Mais
  que presença. Direção para crescer."

### `/login`
Mantido **exatamente como está em `main`** — houve conflito de merge nesse
arquivo (a branch antiga trazia uma versão de login anterior ao trabalho de
Supabase Auth + toggle de tema que já está em produção) e foi resolvido
descartando a versão da branch. Confirmar que o login continua funcionando
normalmente, sem regressão.

## O que ficou de fora, de propósito

**`feat/documentos-storage` (commit `11e2f7e`) não foi mergeada.** O conteúdo
dela (preview de documentos, bucket de storage) já foi superado por trabalho
posterior em `main`: os commits `b65a8f0` ("recover real document
storage/preview") e `7db6260` ("redesign Informações into
Documentos/Trilhas North/Onboarding") reimplementaram a mesma área de forma
mais completa — por exemplo, `lib/documentFiles.ts` em `main` trata mais
tipos de arquivo e detecta Trilhas em HTML, algo que a branch antiga não
fazia. Mergear essa branch reintroduziria uma versão inferior por cima de
código já em produção, com ~6 conflitos reais
(`app/DocumentFilePreview.tsx`, `app/admin/documentos/DocumentPreviewModal.tsx`,
`app/admin/documentos/DocumentsTable.tsx`, `e2e/documents-upload.spec.ts`,
`lib/documentFiles.ts`, `lib/supabase.ts`) para zero ganho. A branch não foi
apagada — permanece disponível localmente caso alguém queira revisitar essa
decisão, mas não deve ser mergeada.

## Verificação automatizada

`npm run verify` (typecheck + `vitest run` + `next build`) passou limpo
nesta branch, sem nenhum ajuste de código de produto — só dois retoques
mecânicos ligados à decisão de mover a home redesenhada para `/lp`:
- `app/(site)/lp/page.tsx`: import do `LeadForm` ajustado de
  `./components/LeadForm` para `../components/LeadForm` (o arquivo passou a
  viver uma pasta mais funda) e `canonical` do metadata ajustado para `/lp`.
- `e2e/public-funnel.spec.ts`: o teste que exercia o formulário de lead
  apontava para `/#diagnostico` (premissa da branch original, onde o
  formulário ficava na home); atualizado para `/lp#diagnostico`, que é onde
  o formulário efetivamente está nesta consolidação.

Os testes E2E (Playwright, `npm run test:e2e`) não foram rodados nesta
verificação — não fazem parte do `npm run verify` do projeto e exigem um
servidor/ambiente de browser à parte. Rodar manualmente antes de promover
este preview para produção.
