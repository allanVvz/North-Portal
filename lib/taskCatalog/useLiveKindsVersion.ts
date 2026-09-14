"use client";

// O hook em si, separado de ./liveKinds.ts de propósito — aquele módulo é
// importado por código de servidor também (via kindDef em lib/taskCatalog.ts),
// e `useSyncExternalStore` quebrava o build nesse caminho. Este arquivo só é
// importado por componentes client de verdade (TaskKindIcon.tsx).

import { useSyncExternalStore } from "react";
import { getLiveKindsVersion, subscribeLiveKinds } from "./liveKinds";

function getServerSnapshot(): number {
  // SSR nunca tem o cache aquecido — a primeira renderização no servidor é
  // sempre a versão 0 (fallback), igual ao que já acontecia antes deste cache
  // existir.
  return 0;
}

/** Só o "algo mudou" — força um novo render pra quem precisa reagir ao cache
 * esquentar. O valor numérico em si não tem significado. */
export function useLiveKindsVersion(): number {
  return useSyncExternalStore(subscribeLiveKinds, getLiveKindsVersion, getServerSnapshot);
}
