// Cache ao vivo de identidade visual (ícone/tom/rótulo) para um tipo de topo
// criado só pela tela "Configurações › Tipos e fluxos" (task_types.icon/tone,
// migração 20260913000000) — sem entrada em `TASK_KINDS` (lib/taskCatalog.ts).
//
// Por que não async: `kindDef`/`kindIcon`/`kindTone`/`kindLabel` são lidos de
// forma SÍNCRONA em dezenas de componentes (Kanban, Calendário, Performance,
// portal) — tornar isso assíncrono era o "refactor de superfície ampla" que
// ficou de fora quando esse gap foi mapeado pela primeira vez
// (docs/ARQUITETURA-TAREFAS.md). Em vez disso: um cache em módulo, alimentado
// por UMA busca (AdminShell.tsx, uma vez por sessão admin), lido de forma
// síncrona — `kindDef` nunca espera nada, só olha o que já está aqui.
//
// SEM `"react"` neste arquivo de propósito: `kindDef` (lib/taskCatalog.ts) é
// importado por código de SERVIDOR também (rotas de API via lib/supabase.ts),
// e um `useSyncExternalStore` neste módulo quebrava o build — o bundler
// recusa puxar um hook de React pra dentro de uma rota server-only. O hook em
// si mora em `./useLiveKindsVersion.ts`, um arquivo `"use client"` à parte,
// que só é importado por componentes de fato client (TaskKindIcon.tsx).

import type { KindDef } from "@/lib/taskCatalog";
import type { TaskTypeDef } from "@/lib/taskTypes";

let cache: Record<string, KindDef> = {};
let version = 0;
const listeners = new Set<() => void>();

/** Substitui o cache inteiro (não faz merge) — a busca em AdminShell.tsx
 * sempre manda o retrato completo do que existe agora em `task_types`. */
export function setLiveKinds(defs: Record<string, KindDef>): void {
  cache = defs;
  version += 1;
  listeners.forEach((listener) => listener());
}

export function getLiveKindDef(key: string): KindDef | undefined {
  return cache[key];
}

export function subscribeLiveKinds(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Só o "algo mudou" — quem usa isto (useLiveKindsVersion) só quer saber que
 * precisa re-renderizar, o número em si não tem significado. */
export function getLiveKindsVersion(): number {
  return version;
}

/** `GET /api/admin/task-types` já só devolve linhas de TOPO em `types`
 * (listTaskTypes agrupa por pai) — não precisa filtrar aqui. Pula tipos sem
 * `icon`/`tone` gravado (os 5 embutidos, cuja linha em `task_types` existe
 * pro trigger de vocabulário mas nunca ganhou identidade visual própria —
 * `kindDef` nem chega a consultar o cache pra eles, `isTaskKind` já resolve
 * antes). `blurb` fica vazio: um tipo self-service não tem esse campo hoje. */
export function buildLiveKindDefs(types: readonly TaskTypeDef[]): Record<string, KindDef> {
  const defs: Record<string, KindDef> = {};
  for (const type of types) {
    if (!type.icon || !type.tone) continue;
    defs[type.key] = { label: type.label, icon: type.icon, tone: type.tone, blurb: "", performance: type.show_in_performance };
  }
  return defs;
}
