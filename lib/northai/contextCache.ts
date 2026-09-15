// Cache do contexto por cliente, à prova de resposta atrasada.
//
// Cada resposta grava na chave do SEU cliente, e só se ainda for a requisição
// mais recente daquele cliente. A tela lê a chave do cliente que está
// mostrando. Então "seleciona Tock, seleciona Baita, a resposta da Tock chega
// por último" nunca pinta a Tock no lugar da Baita. Recarregar mantém o dado
// anterior visível enquanto busca (sem piscar).

export type ContextEntry<T> = { status: "loading" | "ready" | "error"; data: T | null; error: string | null; requestId: number };
export type ContextCache<T> = Record<string, ContextEntry<T>>;

export function cacheStart<T>(cache: ContextCache<T>, clientId: string, requestId: number): ContextCache<T> {
  return { ...cache, [clientId]: { status: "loading", data: cache[clientId]?.data ?? null, error: null, requestId } };
}

export function cacheResolve<T>(cache: ContextCache<T>, clientId: string, requestId: number, data: T): ContextCache<T> {
  if (cache[clientId]?.requestId !== requestId) return cache;
  return { ...cache, [clientId]: { status: "ready", data, error: null, requestId } };
}

export function cacheFail<T>(cache: ContextCache<T>, clientId: string, requestId: number, error: string): ContextCache<T> {
  if (cache[clientId]?.requestId !== requestId) return cache;
  return { ...cache, [clientId]: { status: "error", data: cache[clientId]?.data ?? null, error, requestId } };
}
