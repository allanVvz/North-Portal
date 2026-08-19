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

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  if (!allowed(ip)) return NextResponse.json({ error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." }, { status: 429, headers: { "Retry-After": "600" } });
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Dados inválidos." }, { status: 400 }); }
  const parsed = leadSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Revise os campos informados." }, { status: 422 });
  if (parsed.data.website) return NextResponse.json({ error: "Não foi possível enviar." }, { status: 400 });
  try {
    const phone = normalizeBrazilPhone(parsed.data.phone);
    const { website: _honeypot, utm, ...lead } = parsed.data;
    void _honeypot;
    const supabase = createAdminClient();
    const { data, error } = await supabase.from("leads").insert({ ...lead, phone, utm_source: utm.utm_source, utm_medium: utm.utm_medium, utm_campaign: utm.utm_campaign, utm_term: utm.utm_term, utm_content: utm.utm_content, gclid: utm.gclid, user_agent: request.headers.get("user-agent")?.slice(0,500) }).select("id").single();
    if (error || !data) throw error || new Error("Lead não persistido");
    const number = process.env.WHATSAPP_BUSINESS_NUMBER;
    if (!number) throw new Error("WhatsApp não configurado");
    return NextResponse.json({ id: data.id, whatsapp_url: createWhatsAppUrl(number, data.id, parsed.data) }, { status: 201 });
  } catch (error) {
    console.error("lead_submit_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Não foi possível enviar agora. Tente novamente em instantes." }, { status: 503 });
  }
}
