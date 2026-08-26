import type { PlanoTier, ScopeItem } from "@/lib/validation";

// Pure helpers behind the cadastro/edição form. Kept out of
// ClientFormSections.tsx so they can be unit-tested without pulling JSX into
// the vitest run.

export type CompanyInfoState = { segmento: string; cidadeUf: string; instagramOuSite: string };
export type ContractState = {
  planoTier: PlanoTier | "";
  escopo: ScopeItem[];
  valorMensal: string;
  contractStart: string;
  responsavelNome: string;
  responsavelWhatsapp: string;
};

export const EMPTY_COMPANY: CompanyInfoState = { segmento: "", cidadeUf: "", instagramOuSite: "" };
export const EMPTY_CONTRACT: ContractState = {
  planoTier: "",
  escopo: [],
  valorMensal: "",
  contractStart: "",
  responsavelNome: "",
  responsavelWhatsapp: "",
};

export const PLANO_LABEL: Record<PlanoTier, string> = { start: "Start", growth: "Growth", custom: "Custom" };

/**
 * Reads the currency shapes an admin actually types — "R$ 3.200", "3200",
 * "3.200,50" — into a number. Empty (or punctuation-only) yields null so the
 * column is cleared rather than set to 0.
 */
export function parseValorMensal(raw: string): number | null {
  const cleaned = raw
    .replace(/[^\d,.-]/g, "")
    // drop thousands separators before swapping the decimal comma
    .replace(/\.(?=\d{3}\b)/g, "")
    .replace(",", ".");
  if (!cleaned || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
