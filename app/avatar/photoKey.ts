// Índice de fotos da equipe e as duas formas de procurar dentro dele.
//
// Um comentário de tarefa pode identificar seu autor de duas maneiras, e a
// diferença é histórica:
//
//   * `author_id` — id do perfil, gravado desde a migration 20260827001000.
//     Exato: sobrevive a renomeação e não confunde homônimos.
//   * `author` — nome em texto congelado, sempre presente. É o único que os
//     comentários antigos têm, e o único que um comentário de automação tem.
//
// Por isso a busca é em duas etapas: id primeiro, nome como rede de segurança.
// Ver app/avatar/README.md.

/** Fotos da equipe, indexadas pelas duas chaves possíveis. */
export type TeamPhotoIndex = {
  /** profile.id -> avatar_url */
  byId: Record<string, string>;
  /** nome normalizado -> avatar_url */
  byName: Record<string, string>;
};

export const EMPTY_PHOTO_INDEX: TeamPhotoIndex = { byId: {}, byName: {} };

/**
 * Chave de nome normalizada: sem caixa e sem espaço nas pontas, senão
 * "Allan Silva " gravado num comentário não casaria com "allan silva" vindo
 * do perfil.
 */
export function photoKey(name: string | null | undefined): string {
  return (name ?? "").trim().toLowerCase();
}

/**
 * A foto do autor de um comentário, ou null quando ele não é alguém da equipe
 * (automação, conta apagada, perfil renomeado sem id) — nesse caso a tela cai
 * nas iniciais, que é o que ela já mostrava antes de existir foto.
 */
export function findAuthorPhoto(
  index: TeamPhotoIndex,
  author: { author: string; author_id?: string },
): string | null {
  if (author.author_id) {
    const byId = index.byId[author.author_id];
    // Id presente mas fora do índice = conta apagada. Cai no nome, que ainda
    // pode casar com um perfil homônimo vivo — e se não casar, iniciais.
    if (byId) return byId;
  }
  return index.byName[photoKey(author.author)] ?? null;
}

/** Monta o índice a partir dos perfis da equipe. */
export function buildPhotoIndex(
  team: readonly { id: string; full_name: string | null; avatar_url: string | null }[],
): TeamPhotoIndex {
  const index: TeamPhotoIndex = { byId: {}, byName: {} };
  for (const member of team) {
    if (!member.avatar_url) continue;
    index.byId[member.id] = member.avatar_url;
    if (member.full_name) index.byName[photoKey(member.full_name)] = member.avatar_url;
  }
  return index;
}
