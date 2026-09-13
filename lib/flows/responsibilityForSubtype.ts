// Ponte entre o subtipo de uma etapa (lib/taskCatalog.ts, ex.: "edicao") e a
// responsabilidade cadastrada em Equipe & papéis (lib/validation.ts,
// ResponsibilityKey). Os nomes coincidem por convenção — mas são dois
// vocabulários diferentes (um é subtipo de card, o outro é papel de pessoa) —
// então o mapa fica explícito aqui em vez de comparar strings direto nos
// consumidores.
//
// `gestor_trafego` e `aprovacao` não têm subtipo de etapa correspondente no
// funil de criativo (roteiro → captação → edição → publicação): a primeira já
// tem efeito próprio (notify_responsibility_holders, alheio a isto), a
// segunda segue só informativa por ora. `publicacao` também não mapeia — não
// há responsabilidade "publicação" cadastrada.

import type { ResponsibilityKey } from "@/lib/validation";

const SUBTYPE_RESPONSIBILITY: Partial<Record<string, ResponsibilityKey>> = {
  roteiro: "roteiro",
  captacao: "captacao",
  edicao: "edicao",
};

export function responsibilityForSubtype(subtype: string | null | undefined): ResponsibilityKey | null {
  if (!subtype) return null;
  return SUBTYPE_RESPONSIBILITY[subtype] ?? null;
}
