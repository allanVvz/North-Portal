/** Fail-closed rendering rule for the global Plano de Ação visibility flag. */
export function shouldRenderClientVisibilityToggle(flag: boolean | null | undefined): boolean {
  return flag === true;
}
