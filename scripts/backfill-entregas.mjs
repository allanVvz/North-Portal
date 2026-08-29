// Converte os criativos que estavam em "Publicado" em Entregas com corrente.
//
// Por que existe: "Publicado" deixou de ser um estágio do funil. A informação
// que ele carregava — esta peça foi ao ar — não some junto: ela vira a última
// ETAPA de uma Entrega, que é onde publicar passou a morar. Cada criativo
// publicado vira o card-pai de uma corrente, e as quatro etapas nascem já
// concluídas, marcadas como geradas.
//
// Por que em Node e não em SQL: o id de cada etapa PRECISA ser idêntico ao que
// `flowStepTaskId` produz (sha256 com nibble de versão remendado, ver
// lib/derivedTaskId.ts). Reimplementar isso em pgcrypto seria uma segunda cópia
// da função de identidade, e no dia em que as duas divergissem a idempotência
// morreria em silêncio — a cascata voltaria a produzir duplicatas. A cópia aqui
// é a mesma de sempre, e `lib/derivedTaskId.test.ts` afirma que as duas batem.
//
// Padrão do repositório: dry-run por default, `--apply` para escrever.
//
// Uso:
//   node scripts/backfill-entregas.mjs                      (dry-run)
//   node scripts/backfill-entregas.mjs --apply
//   node scripts/backfill-entregas.mjs --apply --lote=entregas-2026-08-29
//
// Desfazer (o lote inteiro, incluindo os elos, que caem por ON DELETE CASCADE):
//   delete from public.tasks where payload->>'backfill_batch' = '<lote>';
//   update public.tasks set payload = payload - 'flow_parent' - 'flow_total_weight'
//          - 'flow_step_count' - 'backfill_batch'
//    where payload->>'backfill_batch' = '<lote>';

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

function loadEnvLocal() {
  try {
    const txt = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
    }
  } catch {
    /* .env.local opcional */
  }
}

/** Cópia exata de lib/derivedTaskId.ts. Guardada por lib/derivedTaskId.test.ts. */
export function derivedTaskId(parentId, identity) {
  const digest = createHash("sha256").update(`${parentId}:${identity}`).digest("hex").slice(0, 32).split("");
  digest[12] = "5";
  digest[16] = ((parseInt(digest[16], 16) & 3) | 8).toString(16);
  return `${digest.slice(0, 8).join("")}-${digest.slice(8, 12).join("")}-${digest.slice(12, 16).join("")}-${digest.slice(16, 20).join("")}-${digest.slice(20).join("")}`;
}

export const flowStepTaskId = (deliveryId, stepKey) => derivedTaskId(deliveryId, `flow-step:${stepKey}`);

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function main() {
  loadEnvLocal();
  const apply = process.argv.includes("--apply");
  const loteArg = process.argv.find((a) => a.startsWith("--lote="));
  const lote = loteArg ? loteArg.slice("--lote=".length) : `entregas-${new Date().toISOString().slice(0, 10)}`;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.");
  const sb = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  // O molde vem do banco, não de uma constante: congelar 4 na mão faria o
  // denominador do progresso discordar do molde vigente.
  const { data: rootRows, error: rootErr } = await sb
    .from("task_types").select("id").eq("key", "criativo").is("parent_id", null).single();
  if (rootErr || !rootRows) throw new Error(`tipo Entrega não encontrado: ${rootErr?.message}`);
  const { data: steps, error: stepsErr } = await sb
    .from("task_types")
    .select("key,label,order_index,lead_days,progress_weight,default_assignee,client_visible")
    .eq("parent_id", rootRows.id).eq("active", true).order("order_index");
  if (stepsErr || !steps?.length) throw new Error(`etapas da Entrega não encontradas: ${stepsErr?.message}`);
  const totalWeight = steps.reduce((sum, s) => sum + (Number(s.progress_weight) || 1), 0);

  // Os alvos: criativo que ESTEVE publicado (a marca que a migração deixou) e
  // que ainda não é entrega. Um criativo publicado que já virasse entrega por
  // outro caminho é pulado — o script é seguro para rodar duas vezes.
  const { data: parents, error: parentsErr } = await sb
    .from("tasks").select("id,title,client_id,payload")
    .eq("kind", "criativo").not("payload->>publicado_em", "is", null);
  if (parentsErr) throw new Error(`falha ao listar publicados: ${parentsErr.message}`);
  const targets = (parents ?? []).filter((t) => (t.payload ?? {}).flow_parent !== true);

  console.log(`molde: ${steps.map((s) => s.key).join(" → ")} (peso total ${totalWeight})`);
  console.log(`lote: ${lote}`);
  console.log(`publicados encontrados: ${parents?.length ?? 0} — a converter: ${targets.length}`);
  console.log(`cards de etapa a criar: ${targets.length * steps.length}`);

  const today = new Date().toISOString().slice(0, 10);
  let createdSteps = 0;
  let createdLinks = 0;

  for (const parent of targets) {
    const parentPayload = {
      ...(parent.payload ?? {}),
      flow_parent: true,
      flow_total_weight: totalWeight,
      flow_step_count: steps.length,
      backfill_batch: lote,
    };
    if (!apply) console.log(`  entrega ${parent.id} — ${parent.title}`);
    else {
      const { error } = await sb.from("tasks").update({ payload: parentPayload }).eq("id", parent.id);
      if (error) throw new Error(`falha ao marcar entrega ${parent.id}: ${error.message}`);
    }

    for (const step of steps) {
      const id = flowStepTaskId(parent.id, step.key);
      if (!apply) {
        console.log(`    ${step.key.padEnd(12)} ${id}`);
        createdSteps += 1;
        createdLinks += 1;
        continue;
      }
      const row = {
        id,
        client_id: parent.client_id,
        kind: "criativo",
        subtype: step.key,
        title: `${parent.title} — ${step.label}`,
        // Etapa de uma peça que já foi ao ar nasce concluída: o trabalho
        // aconteceu, ele só não estava representado em card.
        status: "aprovado",
        priority: "media",
        plan_id: null,
        due_date: addDays(today, Math.max(0, step.lead_days)),
        start_date: today,
        progress_weight: Number(step.progress_weight) || 1,
        client_visible: step.client_visible,
        position: step.order_index,
        payload: { backfill_batch: lote },
      };
      const { error } = await sb.from("tasks").insert(row);
      // 23505 = a etapa já existe. O id é determinístico justamente para isto.
      if (error && error.code !== "23505") throw new Error(`falha na etapa ${step.key} de ${parent.id}: ${error.message}`);
      if (!error) createdSteps += 1;

      const { error: linkErr } = await sb
        .from("task_links")
        .insert({ parent_id: parent.id, child_id: id, slot: step.key, position: step.order_index });
      if (linkErr && linkErr.code !== "23505") throw new Error(`falha no elo ${step.key} de ${parent.id}: ${linkErr.message}`);
      if (!linkErr) createdLinks += 1;
    }
  }

  console.log(apply
    ? `\nescrito: ${targets.length} entregas, ${createdSteps} etapas, ${createdLinks} elos (lote ${lote})`
    : `\ndry-run — nada foi escrito. Rode de novo com --apply para valer.`);
}

// Só executa quando chamado direto; o teste de idempotência importa o módulo.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  await main();
}
