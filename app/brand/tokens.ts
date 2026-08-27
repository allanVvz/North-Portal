// Cores da marca em valor literal.
//
// O app inteiro usa CSS custom properties (--sand, --petrol, --a-teal...), e
// deve continuar usando. Estes literais existem só para os lugares que NÃO
// enxergam CSS: arquivos SVG estáticos (favicon, apple-icon) e imagens geradas
// no servidor (opengraph). Se um token daqui mudar, rode `npm run brand:icons`.
export const BRAND_COLORS = {
  /** Petróleo escuro — fundo do favicon e das seções escuras. */
  petrol: "#0c282c",
  /** Areia/creme — a tinta da marca sobre fundo escuro. */
  sand: "#e8dcc0",
  /** Sage — a tinta da marca sobre fundo claro. */
  sage: "#78aca8",
} as const;

/** Como o favicon é pintado: creme sobre placa petróleo. */
export const FAVICON = {
  ink: BRAND_COLORS.sand,
  background: BRAND_COLORS.petrol,
  radius: 8,
} as const;
