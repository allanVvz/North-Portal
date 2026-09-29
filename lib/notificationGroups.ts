import type { NotificationRecord } from "./notificationTypes";

// A caixa de entrada agrupada por card (30/09/2026).
//
// As automações e o gatilho de revisão repetem o mesmo aviso sobre o mesmo
// card: numa semana a Luiza recebeu 155 "Revisão atribuída" para 15 cards e
// 72 vezes "Reels Dj Sereno foi concluído". Linha a linha, a caixa virava
// ruído e o sino nunca apagava. Aqui, tudo o que é do MESMO card e do MESMO
// tipo vira uma linha: a mensagem e a hora mais recentes, quantas foram, e os
// ids de todas (para marcar o grupo como lido de uma vez). O grupo está não
// lido se qualquer linha dele estiver. Aviso sem card fica sozinho.

export function groupNotifications(rows: readonly NotificationRecord[]): NotificationRecord[] {
  const groups = new Map<string, NotificationRecord & { count: number; ids: string[] }>();
  const newestFirst = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
  for (const row of newestFirst) {
    const key = row.task_id ? `${row.task_id}:${row.type}` : row.id;
    const group = groups.get(key);
    if (!group) {
      groups.set(key, { ...row, count: 1, ids: [row.id] });
      continue;
    }
    group.count += 1;
    group.ids.push(row.id);
    if (!row.read_at) group.read_at = null;
  }
  return [...groups.values()];
}
