import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { requireAdmin } from "@/lib/supabase/auth";
import { aiComplete } from "@/lib/ai/complete";

// POST /api/admin/insights/ai — escolhe e redige os insights de uma tela
// (30/09/2026). Os FATOS chegam prontos (app/admin/insights/insightCandidates.ts),
// cada um com seu link; a IA só decide quais 3 importam agora e reescreve
// título e detalhe. Ela devolve ids, e a resposta é montada a partir dos
// candidatos recebidos — número e link nunca saem da IA.
//
// Cache em memória por conteúdo (hash dos fatos) por 3h: a mesma situação não
// paga outra chamada a cada visita. Sem IA configurada, ou se ela falhar, vale
// a ordem por peso e o texto original ("regras").

const candidate = z.object({
  id: z.string().max(40),
  tone: z.enum(["late", "warn", "ok", "info"]),
  title: z.string().max(200),
  detail: z.string().max(400),
  href: z.string().max(400).refine((href) => href.startsWith("/admin/"), "link interno"),
  action: z.string().max(60),
  weight: z.number(),
});
const body = z.object({
  screen: z.enum(["home", "clientes", "cliente", "operacao"]),
  candidates: z.array(candidate).max(14),
});
type Candidate = z.infer<typeof candidate>;
type Insight = Candidate & { source: "ia" | "regras" };

const TTL_MS = 3 * 60 * 60_000;
const cache = new Map<string, { at: number; insights: Insight[] }>();

const SCREEN_FOCUS: Record<z.infer<typeof body>["screen"], string> = {
  home: "a tela inicial de quem trabalha na agência, olhando os últimos 7 dias: o que destravar primeiro",
  operacao: "a fila de trabalho da agência: gargalos, atrasos e o que está parado",
  clientes: "a carteira de clientes no mês: quem precisa de atenção e o que está dando resultado",
  cliente: "a página de um cliente: o que fazer por ele agora",
};

const SCHEMA = {
  name: "insights",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["picks"],
    properties: {
      picks: {
        type: "array",
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "title", "detail"],
          properties: { id: { type: "string" }, title: { type: "string" }, detail: { type: "string" } },
        },
      },
    },
  },
};

const byRules = (candidates: Candidate[]): Insight[] =>
  [...candidates].sort((a, b) => b.weight - a.weight).slice(0, 3).map((item) => ({ ...item, source: "regras" }));

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const { screen, candidates } = body.parse(await request.json());
    if (!candidates.length) return NextResponse.json({ insights: [] });
    const key = createHash("sha256").update(JSON.stringify([screen, candidates.map(({ id, title, detail }) => [id, title, detail])])).digest("hex");
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json({ insights: hit.insights });

    let insights = byRules(candidates);
    let answered = false;
    try {
      const raw = await aiComplete({
        system: [
          "Você é o analista de operações de uma agência de marketing digital brasileira.",
          `Contexto: ${SCREEN_FOCUS[screen]}.`,
          "Receberá fatos já verificados, cada um com id. Escolha até 3 que mais ajudam a decidir o que fazer AGORA, em ordem de importância.",
          "Prefira o que destrava trabalho e o que tem prazo; um fato positivo só entra se sobrar espaço.",
          "Reescreva cada escolhido em português do Brasil: título curto (até 70 caracteres) que MANTÉM o número principal e o nome (pessoa ou cliente) do fato, e detalhe de uma frase dizendo por que importa e o próximo passo.",
          "Use SOMENTE os números e nomes presentes nos fatos. Não invente dados, prazos nem causas.",
        ].join("\n"),
        user: JSON.stringify(candidates.map(({ id, tone, title, detail }) => ({ id, tone, fato: title, contexto: detail }))),
        maxTokens: 600,
        jsonSchema: SCHEMA,
      });
      const picks = (JSON.parse(raw) as { picks?: { id: string; title: string; detail: string }[] }).picks ?? [];
      const byId = new Map(candidates.map((item) => [item.id, item]));
      const chosen = picks
        .filter((pick, index, all) => byId.has(pick.id) && all.findIndex((other) => other.id === pick.id) === index)
        .map((pick): Insight => ({ ...byId.get(pick.id)!, title: pick.title.slice(0, 120) || byId.get(pick.id)!.title, detail: pick.detail.slice(0, 280) || byId.get(pick.id)!.detail, source: "ia" }));
      if (chosen.length) { insights = chosen; answered = true; }
    } catch {
      // Sem IA (não configurada, fora do ar, JSON inválido): ficam as regras.
    }
    // Resposta da IA vale 3h; o recurso às regras só 10 min, para a IA ter
    // outra chance logo que voltar.
    cache.set(key, { at: answered ? Date.now() : Date.now() - TTL_MS + 10 * 60_000, insights });
    if (cache.size > 200) cache.delete(cache.keys().next().value!);
    return NextResponse.json({ insights });
  } catch (error) {
    return apiError(error);
  }
}
