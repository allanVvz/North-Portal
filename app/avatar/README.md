# Foto de perfil — onde aparece e como se mantém coerente

Uma pessoa tem **uma** foto. Ela é gravada em `profiles.avatar_url` e aparece
hoje em cinco lugares, com duas formas de resolução diferentes. Este arquivo é
o mapa.

## A origem

A foto é enviada em **Configurações → Minha conta**, sobe para o bucket
`avatars` e a URL pública é gravada no perfil:

| Etapa | Arquivo |
|---|---|
| Botão e preview | `app/admin/configuracoes/SettingsPanel.tsx` (`MyAccountForm`) |
| Chamada do cliente | `lib/avatarUpload.ts` |
| Rota que sobe e grava | `app/api/admin/me/avatar/route.ts` |
| Escrita no perfil | `updateMyProfile()` — `lib/supabase.ts` |

O upload passa por rota de servidor com service role, e não direto do
navegador como os documentos fazem — o motivo está comentado em
`app/api/admin/me/avatar/route.ts` (anomalia de RLS no bucket `avatars`).

A URL recebe `?v=<timestamp>` no final (`route.ts`) justamente para o navegador
não continuar mostrando a foto antiga depois da troca.

## Onde a foto aparece

| # | Tela | Componente | Como acha a foto |
|---|---|---|---|
| 1 | Configurações → Minha conta | `SettingsPanel.tsx` · `MyAccountForm` | `getMyProfile()` do próprio usuário |
| 2 | Configurações → Equipe & papéis | `SettingsPanel.tsx` · `TeamList` | `listTeam()` traz `avatar_url` de cada perfil |
| 3 | Barra lateral do admin (cartão de conta e menu) | `app/admin/AdminShell.tsx` | `getMyProfile()` em `app/admin/layout.tsx` → prop `avatarUrl` |
| 4 | Comentários das tarefas | `app/admin/CommentAvatar.tsx`, usado por `TaskModal.tsx` e `TaskDetailPanel.tsx` | **pelo nome** — ver a ressalva abaixo |
| 5 | Quem somos (público) | `app/(site)/quem-somos/page.tsx` | `listPublicTeamProfiles()`, só perfis com `cargo` preenchido |

Os quatro primeiros são do admin e exigem sessão. O quinto é público e sem
sessão, por isso lê via service role selecionando **apenas** `full_name`,
`cargo`, `bio` e `avatar_url` — nunca e-mail, papel ou `client_id`
(`listPublicTeamProfiles()` em `lib/supabase.ts`).

## Uma regra só para "foto ou iniciais?"

`app/avatar/UserAvatar.tsx`. Se há foto, mostra a foto; se não há, mostra as
iniciais. Nenhuma tela decide isso sozinha.

A classe do círculo continua sendo de quem monta (`.admin-avatar`,
`.tm-comment-av`, `.set-team-av`, `.set-avatar-big`), porque tamanho e cor são
do contexto. Um círculo que vai receber foto precisa de `overflow: hidden`; a
foto se ajusta sozinha pela regra `.avatar-photo` em `app/globals.css`, que faz
`object-fit: cover` e herda o arredondamento do círculo.

**Quem somos é a exceção deliberada**: lá o retrato é um card de 220px
(`.team-photo` / `.placeholder-photo.initials` em `app/(site)/site.css`), não um
chip redondo. A tela mantém a própria estrutura e usa só a regra de iniciais
compartilhada.

## Uma regra só para as iniciais

`app/avatar/initials.ts` — primeiro + último nome.

Antes existiam três regras diferentes e a mesma pessoa aparecia com sigla
diferente conforme a tela: "Allan Ulisses Silva" era `AS` no Kanban e em Quem
Somos, mas `AU` na barra lateral e em Configurações. Todos os pontos foram
unificados: `kanbanShared.ts` reexporta a regra única, e `ClientsTable`,
`ClientPipelineBoard`, `DocumentsTable`, `SettingsPanel` e `quem-somos`
importam dela.

## A ressalva dos comentários

Esta é a única resolução que **não** é por id de perfil, e é importante saber
por quê.

Um comentário de tarefa grava o autor como **texto congelado**:

```ts
export type TaskComment = { author: string; text: string; at: string; edited_at?: string };
```
`lib/comments.ts`

Isso é proposital — é o que mantém os comentários antigos legíveis depois que
uma conta é apagada, e é o que permite autores que não são pessoas
(`author: "Automação"`, em `lib/automations/taskAccess.ts`). O preço é que não
existe id para buscar a foto: ela só pode ser encontrada casando o nome.

O índice nome → foto é montado uma vez por navegação do admin em
`app/admin/layout.tsx` e distribuído por `TeamPhotosProvider`
(`app/admin/CurrentUserContext.tsx`), no mesmo padrão do `CurrentUserProvider`
que já existia — sem prop drilling por board e modal.

Quando o nome não casa, cai nas iniciais. Isso acontece com:

- autor que não é pessoa (`Automação`, `Sistema`);
- perfil renomeado depois do comentário;
- conta apagada.

Em todos esses casos o resultado é exatamente o que a tela mostrava antes desta
mudança, então nada regride. Dois perfis homônimos mostrariam a mesma foto — o
pior caso é a foto errada entre duas pessoas de mesmo nome, nunca vazamento de
dado.

**Se um dia isso precisar ser exato**, o caminho é gravar `author_id` junto do
`author` nos comentários novos (mantendo o texto para os antigos) e resolver
por id quando o campo existir. Não vale reescrever os comentários antigos: o
nome em texto é justamente o registro histórico.

## Checklist ao adicionar um lugar novo

1. Use `<UserAvatar name={...} photoUrl={...} className="sua-classe" />`.
2. Dê `overflow: hidden` à classe do círculo.
3. Garanta que a consulta que alimenta a tela **seleciona `avatar_url`** — foi
   exatamente o que faltava em `listTeam()` e fazia a foto sumir em Equipe &
   papéis.
4. Acrescente a linha na tabela "Onde a foto aparece" acima.
