// Uma cor por responsabilidade (Equipe & papéis), reaproveitando as 5
// tonalidades que já existem no design system (app/globals.css: `.tone-*`,
// `.kb-type.t-tone-*`) em vez de inventar uma paleta nova. Mesmo princípio de
// `app/admin/performance/performanceLabels.ts: platformTone()` — um mapa
// fixo valor → classe, nunca um hash de nome/cor calculado.
//
// Usado tanto pelo chip do dropdown de responsável (AssigneePicker) quanto
// pelo selo de papel ao lado de um comentário (TaskModal) — uma função só,
// para as duas telas nunca divergirem sobre "que cor é o quê".

import type { ResponsibilityKey } from "@/lib/validation";

const RESPONSIBILITY_TONE: Record<ResponsibilityKey, string> = {
  edicao: "t-tone-purple",
  captacao: "t-tone-blue",
  roteiro: "t-tone-green",
  gestor_trafego: "t-tone-gold",
  aprovacao: "t-tone-neutral",
};

export function roleTone(responsibility: ResponsibilityKey): string {
  return RESPONSIBILITY_TONE[responsibility];
}

export const ROLE_LABEL: Record<ResponsibilityKey, string> = {
  edicao: "Editor",
  captacao: "Captador",
  roteiro: "Roteirista",
  gestor_trafego: "Gestor de tráfego",
  aprovacao: "Aprovador",
};

/** Rótulo do papel "revisor" — não é uma responsabilidade cadastrada em
 * Equipe & papéis (é um campo próprio, `reviewer_id`), mas precisa do mesmo
 * tratamento visual (chip `.kb-type`) no selo de comentário. */
export const REVISOR_LABEL = "Revisor";
export const REVISOR_TONE = "t-tone-neutral";
