// Os formatos de publicação que o NorthAi reconhece — num roteiro colado, num
// comando curto ("3 reels e 1 carrossel") ou na linha da receita.
//
// `formato` é o valor que vai para `payload.formato` do card (o mesmo campo do
// atributo Formato no modal, FORMATO_OPTIONS em app/admin/kanbanShared.ts).
// O formato é escolhido ao criar cada peça — na maioria das vezes é Reels, por
// isso é o padrão quando nada no texto indica outro.

export type NorthFormatKey = "reels" | "carrossel" | "story" | "banner" | "post" | "anuncio";

export type NorthFormat = {
  key: NorthFormatKey;
  label: string;
  plural: string;
  formato: string;
  /** Palavras normalizadas (minúsculas, sem acento) que indicam o formato. */
  words: readonly string[];
};

export const NORTH_FORMATS: readonly NorthFormat[] = [
  { key: "reels", label: "Reels", plural: "Reels", formato: "Reels vertical", words: ["reels", "reel", "video", "videos"] },
  { key: "carrossel", label: "Carrossel", plural: "Carrosséis", formato: "Carrossel", words: ["carrossel", "carrosseis", "carrosel", "carousel"] },
  { key: "story", label: "Story", plural: "Stories", formato: "Stories", words: ["story", "stories", "storys"] },
  { key: "banner", label: "Banner", plural: "Banners", formato: "Banner", words: ["banner", "banners", "flyer", "flyers"] },
  { key: "post", label: "Post", plural: "Posts", formato: "Post feed", words: ["post", "posts", "feed"] },
  { key: "anuncio", label: "Anúncio", plural: "Anúncios", formato: "Reels vertical", words: ["anuncio", "anuncios", "ad", "ads"] },
];

export const DEFAULT_FORMAT: NorthFormatKey = "reels";

export function normalizeText(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function formatByKey(key: NorthFormatKey): NorthFormat {
  return NORTH_FORMATS.find((format) => format.key === key) ?? NORTH_FORMATS[0];
}

export function formatFromWord(word: string): NorthFormatKey | null {
  const clean = normalizeText(word).replace(/[^a-z]/g, "");
  if (!clean) return null;
  return NORTH_FORMATS.find((format) => format.words.includes(clean))?.key ?? null;
}

/** O primeiro formato mencionado no texto, ou null. */
export function detectFormat(text: string): NorthFormatKey | null {
  for (const token of normalizeText(text).split(/[^a-z0-9]+/)) {
    const key = formatFromWord(token);
    if (key) return key;
  }
  return null;
}
