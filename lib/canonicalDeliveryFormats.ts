export const CANONICAL_DELIVERY_FORMATS = [
  { key: "entrega_reels", label: "Reels", icon: "▶" },
  { key: "entrega_story", label: "Story", icon: "◔" },
  { key: "entrega_carrossel", label: "Carrossel", icon: "▦" },
  { key: "entrega_anuncio", label: "Anúncio", icon: "◎" },
  { key: "entrega_banner", label: "Banner", icon: "▬" },
] as const;

export function canonicalFormatKey(label: string): string | null {
  return CANONICAL_DELIVERY_FORMATS.find((format) =>
    format.label.toLocaleLowerCase("pt-BR") === label.trim().toLocaleLowerCase("pt-BR"))?.key ?? null;
}

export function isCreativeDeliveryKind(kind: string): boolean {
  return kind === "criativo" || CANONICAL_DELIVERY_FORMATS.some((format) => format.key === kind);
}
