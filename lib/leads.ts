import { z } from "zod";

export const leadSchema = z.object({
  name: z.string().trim().min(2).max(100),
  company: z.string().trim().min(2).max(140),
  phone: z.string().min(10).max(30),
  segment: z.string().trim().min(2).max(80),
  region: z.string().trim().min(2).max(120),
  objective: z.string().trim().min(5).max(800),
  investment: z.enum(["até-3k", "3k-6k", "6k-12k", "12k+"]),
  website: z.string().max(0).optional().default(""),
  source_page: z.string().trim().max(300).default("/"),
  consent_analytics: z.boolean().default(false),
  utm: z.record(z.string(), z.string().max(300)).default({}),
}).strict();

export type LeadInput = z.infer<typeof leadSchema>;

export function normalizeBrazilPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length >= 12) return `+${digits}`;
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  throw new Error("Telefone inválido");
}

export function createWhatsAppUrl(number: string, leadId: string, input: Pick<LeadInput,"name"|"company"|"segment"|"region"|"objective">) {
  const destination = number.replace(/\D/g, "");
  if (destination.length < 12) throw new Error("WHATSAPP_BUSINESS_NUMBER inválido");
  const message = `Olá, North! Enviei o diagnóstico ${leadId}.\n\nSou ${input.name}, da ${input.company}.\nSegmento: ${input.segment}\nRegião: ${input.region}\nObjetivo: ${input.objective}`;
  return `https://wa.me/${destination}?text=${encodeURIComponent(message)}`;
}
