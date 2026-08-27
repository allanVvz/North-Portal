import CompassMark from "./CompassMark";

// O "lockup": símbolo + nome (+ descritor), que é como a marca aparece de fato
// nas telas. Antes cada tela montava o seu na mão, com classe, tamanho e texto
// próprios — mudar a marca significava caçar quatro trechos de JSX diferentes.
//
// Aqui está o registro de todos eles. Cada variante mantém EXATAMENTE as
// classes e a estrutura que a tela já usava, então o CSS de cada contexto
// continua valendo sem alteração; o que mudou é que agora existe um só lugar
// para editar tamanho, texto e composição.
//
// O elemento de fora (o <Link>/<div> com .admin-brand, .site-brand,
// .auth-brand) continua sendo de quem monta — é ele que decide para onde a
// marca navega e não é assunto da marca em si.

export type BrandVariant =
  /** Barra lateral do admin: NORTH + admin, símbolo em placa arredondada. */
  | "admin"
  /** Cabeçalho do site público: north + descritor. */
  | "site"
  /** Rodapé do site público: north, sem descritor. */
  | "site-compact"
  /** Tela de login: north + Portal. */
  | "auth";

type LockupSpec = {
  /** Tamanho do símbolo, em px. */
  markSize: number;
  /** Classe do invólucro do símbolo — é ela que define a cor via `color`. */
  markClass: string;
  /** Como o nome é renderizado neste contexto. */
  word: { text: string; as: "b" | "strong" | "span"; className?: string };
  /** Texto de apoio ao lado do nome. */
  descriptor?: { text: string; as: "span" | "em"; className?: string };
};

const LOCKUPS: Record<BrandVariant, LockupSpec> = {
  admin: {
    markSize: 16,
    markClass: "admin-mark",
    word: { text: "NORTH", as: "span", className: "admin-word" },
    descriptor: { text: "admin", as: "span", className: "admin-role" },
  },
  site: {
    markSize: 22,
    markClass: "site-compass",
    word: { text: "north", as: "b" },
    descriptor: { text: "estratégia & operação", as: "span" },
  },
  "site-compact": {
    markSize: 22,
    markClass: "site-compass",
    word: { text: "north", as: "b" },
  },
  auth: {
    markSize: 18,
    markClass: "auth-mark",
    word: { text: "north", as: "strong", className: "wordmark" },
    descriptor: { text: "Portal", as: "em" },
  },
};

export default function BrandLockup({ variant }: { variant: BrandVariant }) {
  const spec = LOCKUPS[variant];
  const Word = spec.word.as;
  const Descriptor = spec.descriptor?.as;

  return (
    <>
      <span className={spec.markClass} aria-hidden>
        <CompassMark size={spec.markSize} />
      </span>
      <Word className={spec.word.className}>{spec.word.text}</Word>
      {Descriptor && spec.descriptor ? (
        <Descriptor className={spec.descriptor.className}>{spec.descriptor.text}</Descriptor>
      ) : null}
    </>
  );
}
