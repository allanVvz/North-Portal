// Aviso de rotina chegando (ATA 14/09).
//
// "Diária de gravação: precisa vir notificação pra mim que precisamos agendar."
// Uma demanda recorrente é guia: fica sempre aberta, com a próxima data no
// futuro, e dois dias antes dessa data quem é responsável recebe o aviso para
// agendar/preparar. Roda no tique diário do cron (9h em Brasília), junto das
// automações.
//
// Fora: rotinas encerradas (molde aprovado/parado) e os moldes alvo de
// automação de relatório — esses se resolvem sozinhos, e avisar "agende" seria
// ruído.

import { recurrenceStopped } from "@/lib/recurrenceState";
import { agencyToday } from "@/lib/time/agency";
import { notifyFromAutomation } from "./notify";
import type { AdminClient } from "./taskAccess";

const WINDOW_DAYS = 2;

function plusDays(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function shortDate(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${day}/${month}`;
}

export async function remindUpcomingRoutines(admin: AdminClient, today = agencyToday()): Promise<number> {
  const [{ data: molds, error }, { data: configs }] = await Promise.all([
    admin
      .from("tasks")
      .select("id,title,due_date,status,payload")
      .not("recurrence_cadence", "is", null)
      .gte("due_date", today)
      .lte("due_date", plusDays(today, WINDOW_DAYS)),
    admin.from("automation_configs").select("target_task_id").eq("active", true),
  ]);
  if (error) throw error;
  const automated = new Set((configs ?? []).map((row) => (row as { target_task_id: string }).target_task_id));

  let sent = 0;
  for (const mold of (molds ?? []) as { id: string; title: string; due_date: string; status: string; payload: Record<string, unknown> | null }[]) {
    if (mold.payload?.recurrence_group !== true || recurrenceStopped(mold.status as never) || automated.has(mold.id)) continue;
    const when = mold.due_date === today ? "hoje" : `em ${shortDate(mold.due_date)}`;
    await notifyFromAutomation(admin, mold.id, "task_due_soon", `Rotina "${mold.title}" vence ${when} — confirme o agendamento da próxima entrega.`);
    sent += 1;
  }
  return sent;
}
