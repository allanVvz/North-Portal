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
| 4 | Comentários das tarefas | `app/admin/CommentAvatar.tsx`, usado por `TaskModal.tsx` e `TaskDetailPanel.tsx` | **por id, com o nome de rede** — ver abaixo |
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

## Os comentários: id primeiro, nome de rede

Esta é a única resolução em duas etapas do app, e vale entender por quê.

Um comentário de tarefa guarda o autor de duas formas:

```ts
export type TaskComment = {
  author: string;      // nome congelado — SEMPRE presente
  author_id?: string;  // id do perfil — desde a migration 20260827001000
  text: string; at: string; edited_at?: string;
};
```
`lib/comments.ts`

O `author` em texto é proposital e não vai embora: é ele que mantém o
comentário legível depois que a conta é apagada, e é o único autor que um
comentário de automação tem (`author: "Automação"`, em
`lib/automations/taskAccess.ts`). O `author_id` é um extra por cima, não um
substituto.

A busca está em `findAuthorPhoto()` (`app/avatar/photoKey.ts`):

1. **Tem `author_id` e ele está no índice?** Usa a foto desse perfil. Exato:
   acerta mesmo se a pessoa foi renomeada depois do comentário, e não confunde
   dois homônimos.
2. **Senão, casa o nome.** É o que atende os comentários antigos e o id de uma
   conta que foi apagada.
3. **Senão, iniciais.** Automação, conta apagada sem homônimo, perfil sem foto.

O índice (`buildPhotoIndex()`) é montado uma vez por navegação em
`app/admin/layout.tsx` e distribuído por `TeamPhotosProvider`
(`app/admin/CurrentUserContext.tsx`), no mesmo padrão do `CurrentUserProvider`
que já existia — sem prop drilling por board e modal.

### Os comentários antigos não foram reescritos

Os ~96 comentários que já existiam continuam só com o nome. Eles não têm id
porque naquele momento não havia — atribuir um agora seria adivinhar quem
escreveu, e o fallback por nome já os atende. Comentário antigo continua
exatamente como está, e é assim que deve ficar: ele é registro histórico.

`edit_task_comment` (migration 20260826120000) não precisou de ajuste — ele
mescla o objeto com `||`, então o `author_id` sobrevive à edição sozinho.

## Checklist ao adicionar um lugar novo

1. Use `<UserAvatar name={...} photoUrl={...} className="sua-classe" />`.
2. Dê `overflow: hidden` à classe do círculo.
3. Garanta que a consulta que alimenta a tela **seleciona `avatar_url`** — foi
   exatamente o que faltava em `listTeam()` e fazia a foto sumir em Equipe &
   papéis.
4. Acrescente a linha na tabela "Onde a foto aparece" acima.
