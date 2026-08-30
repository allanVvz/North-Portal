// Parte da caixa de notificações que o navegador também precisa: tipos,
// rótulos e o shape do registro.
//
// Vive fora de lib/notifications.ts porque aquele módulo importa
// `lib/supabase/server` (e portanto `next/headers`), o que quebra o build
// assim que um client component importa qualquer VALOR de lá — importar só
// tipos funcionava por acidente, já que o TypeScript apaga essas importações.

// Esta lista é o vocabulário E o conjunto de regras: a tela
// Configurações › Notificações liga e desliga um tipo de cada vez, para a
// agência inteira, e a regra é lida DENTRO do banco (ver
// public.notifications_enabled). Acrescentar um tipo aqui e no schema de
// `notificationRules` é o suficiente para ele aparecer configurável.
//
// `metric_collection_requested` morava aqui: um tipo declarado, rotulado e
// iconizado que nunca teve produtor nenhum. Saiu.
export const NOTIFICATION_TYPES = [
  "task_review_assigned",
  "task_due_soon",
  // Atividade do card — todos os envolvidos recebem (ver
  // notifyTaskParticipants e a migration 20260826090200).
  "task_created",
  "task_commented",
  "task_updated",
  "task_status_changed",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export type NotificationRecord = {
  id: string;
  profile_id: string;
  task_id: string | null;
  type: NotificationType;
  message: string;
  read_at: string | null;
  created_at: string;
};

export const NOTIFICATION_TYPE_LABEL: Record<NotificationType, string> = {
  task_review_assigned: "Revisão",
  task_due_soon: "Prazo",
  task_created: "Card novo",
  task_commented: "Comentário",
  task_updated: "Edição",
  task_status_changed: "Status",
};
