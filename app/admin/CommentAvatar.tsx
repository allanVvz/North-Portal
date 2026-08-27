"use client";

import UserAvatar from "../avatar/UserAvatar";
import { useTeamPhoto } from "./CurrentUserContext";

// Avatar de quem assinou um comentário de tarefa.
//
// Existe como componente próprio porque a resolução aqui é diferente de todo
// o resto do app: em Configurações, na barra lateral e em Quem Somos o perfil
// é conhecido e a foto vem junto do registro. No comentário não — o autor é um
// nome em texto congelado no payload da tarefa (`TaskComment.author`,
// lib/comments.ts), então a foto precisa ser procurada pelo nome no índice da
// equipe (TeamPhotosProvider, montado em app/admin/layout.tsx).
//
// Quando o nome não casa — automação, conta apagada, perfil renomeado depois do
// comentário — cai nas iniciais, que é exatamente o que a tela mostrava antes
// desta mudança. Ver app/avatar/README.md.
export default function CommentAvatar({ author, className }: { author: string; className: string }) {
  return <UserAvatar name={author} photoUrl={useTeamPhoto(author)} className={className} />;
}
