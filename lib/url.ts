// Tirar UM parâmetro de uma querystring sem mexer nos outros — usado ao
// consumir um deep-link (`?task=<id>`): a URL some do id lido, mas um filtro
// como `?situacao=atrasada` que viesse junto continua valendo.
export function withoutParam(pathname: string, search: string, key: string): string {
  const params = new URLSearchParams(search);
  params.delete(key);
  const rest = params.toString();
  return rest ? `${pathname}?${rest}` : pathname;
}
