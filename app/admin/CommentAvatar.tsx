"use client";

import type { TaskComment } from "@/lib/comments";
import UserAvatar from "../avatar/UserAvatar";
import { useAuthorPhoto } from "./CurrentUserContext";

// Avatar de quem assinou um comentário de tarefa.
//
// Existe como componente próprio porque a resolução aqui é diferente de todo o
// resto do app: em Configurações, na barra lateral e em Quem Somos o perfil é
// conhecido e a foto vem junto do registro. No comentário o autor pode vir de
// duas formas — `author_id` (exato, desde a migration 20260827001000) ou só
// `author` em texto (comentário antigo, ou automação). A busca tenta o id e
// cai no nome; ver app/avatar/README.md.
//
// Quando nenhum dos dois casa — automação, conta apagada — mostra as iniciais,
// que é o que a tela sempre mostrou.
export default function CommentAvatar({ comment, className }: { comment: TaskComment; className: string }) {
  return <UserAvatar name={comment.author} photoUrl={useAuthorPhoto(comment)} className={className} />;
}
