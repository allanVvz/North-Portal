import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createWhatsAppUrl, leadSchema, normalizeBrazilPhone } from "@/lib/leads";

const WINDOW_MS = 10 * 60 * 1000;
const LIMIT = 5;
const attempts = new Map<string, number[]>();

function allowed(ip: string) {
  const now = Date.now();
  const recent = (attempts.get(ip) || []).filter((time) => now - time < WINDOW_MS);
  if (recent.length >= LIMIT) return false;
  recent.push(now); attempts.set(ip, recent); return true;
}

// Duas responsabilidades, separadas de propósito:
//   1. GRAVAR o lead — é o que não pode falhar em silêncio. Uma falha aqui é
//      genuinamente retryável (banco fora, RLS), então devolve 5xx e o front
//      pede pra tentar de novo.
//   2. Montar o link do WhatsApp — melhor-esforço. Se WHATSAPP_BUSINESS_NUMBER
//      não estiver definido/for inválido, o lead JÁ está salvo: devolve 201 com
//      `whatsapp_url: null` e o front confirma sem redirecionar. É config de
//      deploy, não erro de runtime — o log diz exatamente o que o operador faz.
export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  if (!allowed(ip)) return NextResponse.json({ error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." }, { status: 429, headers: { "Retry-After": "600" } });

  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Dados inválidos." }, { status: 400 }); }

  const parsed = leadSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Revise os campos informados." }, { status: 422 });
  // Honeypot preenchido = bot. Aceita em silêncio (sem persistir) pra não dar
  // sinal de que a armadilha existe.
  if (parsed.data.website) return NextResponse.json({ id: null, whatsapp_url: null }, { status: 201 });

  let phone: string;
  try {
    phone = normalizeBrazilPhone(parsed.data.phone);
  } catch {
    return NextResponse.json({ error: "Confira o número de WhatsApp informado." }, { status: 422 });
  }

  const { website: _honeypot, utm, ...lead } = parsed.data;
  void _honeypot;

  let leadId: string;
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.from("leads").insert({
      ...lead,
      phone,
      utm_source: utm.utm_source,
      utm_medium: utm.utm_medium,
      utm_campaign: utm.utm_campaign,
      utm_term: utm.utm_term,
      utm_content: utm.utm_content,
      gclid: utm.gclid,
      user_agent: request.headers.get("user-agent")?.slice(0, 500),
    }).select("id").single();
    if (error || !data) throw error ?? new Error("insert não retornou linha");
    leadId = data.id;
  } catch (error) {
    console.error("[leads] falha ao gravar o lead:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Não conseguimos registrar agora. Tente de novo em instantes." }, { status: 503 });
  }

  let whatsappUrl: string | null = null;
  try {
    const number = process.env.WHATSAPP_BUSINESS_NUMBER;
    if (!number) throw new Error("variável de ambiente WHATSAPP_BUSINESS_NUMBER ausente");
    whatsappUrl = createWhatsAppUrl(number, leadId, parsed.data);
  } catch (error) {
    console.error(
      `[leads] lead ${leadId} salvo, mas sem link de WhatsApp — ${error instanceof Error ? error.message : error}. ` +
        "AÇÃO: defina WHATSAPP_BUSINESS_NUMBER (Production) na Vercel (só dígitos, com código do país, ex.: 5511999999999) e faça um novo deploy.",
    );
  }

  return NextResponse.json({ id: leadId, whatsapp_url: whatsappUrl }, { status: 201 });
}
