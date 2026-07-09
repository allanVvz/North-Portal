# Telas em produção (Vercel) vs. só em local

Este documento existe porque **nem toda tela do código está visível em produção**. Existem dois mecanismos de bloqueio, de naturezas diferentes, e é fácil confundir um com o outro.

## 1. Portal do Cliente (`app/[slug]/PortalPaged.tsx`) — bloqueio por build

```ts
const IS_DEV_BUILD = process.env.NODE_ENV !== "production";
const LOCKED_IN_PROD: PageId[] = ["acessos", "dashboard", "time-north"];
```

`NODE_ENV=production` é setado pela Vercel tanto em **Production** quanto em **Preview** — ou seja, esse bloqueio vale para qualquer deploy na Vercel, não só o domínio de produção. Só fica destravado rodando `npm run dev` local.

**Bloqueadas em qualquer deploy (Vercel), só visíveis em `localhost`:**
| Tela | `PageId` |
|---|---|
| Acessos & Pastas | `acessos` |
| Dashboard | `dashboard` |
| Time North | `time-north` |

**Live em produção (visíveis para o cliente real):**
| Tela | `PageId` |
|---|---|
| Início | `inicio` |
| Jornada (Central de pendências) | `jornada` |
| Briefing | `briefing` |
| Agenda | `agenda` |
| Feedbacks | `feedbacks` |
| Plano de Ação | `plano-acao` |
| Trilhas North | `trilhas` |
| Documentos | `documentos` |
| Central Comercial | `central` |
| Configurações | `config` |

Para destravar uma tela: remover a entrada correspondente do array `LOCKED_IN_PROD` e fazer deploy. O botão de navegação continua existindo e visível (não é escondido do menu) — só o destino fica inacessível (clique não navega, hash direto redireciona pra Início).

## 2. Feedbacks — bloqueio por cliente (dado, não build)

Diferente do bloqueio acima, isso **não depende de ambiente** — é uma flag por cliente, salva no banco (`client_flow_flags.aprovacao_cliente`), configurável em **Admin → Configurações → Etapas**. Se desligada para um cliente específico, a tela "Feedbacks" some do menu **daquele cliente**, mesmo em produção, mesmo com o código 100% deployado. Outros clientes com o flag ligado continuam vendo normalmente.

Ou seja: `feedbacks` está "em produção" no sentido do item 1 (não é uma tela WIP bloqueada por build), mas pode estar invisível para clientes específicos por decisão operacional.

## 3. Admin (`app/admin/**`) — sem bloqueio nenhum

Todas as telas do admin (Plano de Ação, Tarefas/Kanban, Revisões, Aprovações, Clientes, Performance, Informações, Configurações) estão **sempre live em produção** para quem tem login de admin. Não existe `IS_DEV_BUILD` nem equivalente no lado admin — qualquer tela que existe no código do admin já está em produção assim que o deploy sobe.

## 4. Site público (`app/(site)`) — sem bloqueio nenhum

Landing, Planos, Como funciona, Quem somos, páginas legais, login e recuperação de senha: todas sempre live, sem gate.

## Resumo rápido

| Área | Mecanismo de bloqueio | Onde configurar |
|---|---|---|
| Portal do cliente — Acessos/Dashboard/Time North | Build (`NODE_ENV`) | `LOCKED_IN_PROD` em `PortalPaged.tsx`, requer deploy |
| Portal do cliente — Feedbacks | Dado por cliente | Admin → Configurações → Etapas → Aprovação → "Ativo para Cliente" |
| Admin (todas as telas) | Nenhum | — sempre em produção |
| Site público (todas as telas) | Nenhum | — sempre em produção |
