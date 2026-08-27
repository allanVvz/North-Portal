// Chave de busca da foto de uma pessoa pelo nome.
//
// Existe porque os comentários de tarefa gravam o autor como texto congelado,
// não como id de perfil (ver a ressalva em app/avatar/README.md) — então a
// única forma de achar a foto do autor é casar o nome. A normalização precisa
// ser tolerante a caixa e espaço, senão "Allan Silva " gravado num comentário
// não casaria com "allan silva" vindo do perfil.
//
// Fica em módulo próprio (e não junto do contexto React que a usa) por ser
// função pura — assim dá para testar sem arrastar JSX junto.
export function photoKey(name: string | null | undefined): string {
  return (name ?? "").trim().toLowerCase();
}
