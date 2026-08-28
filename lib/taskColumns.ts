// A projeção de leitura de `tasks`, isolada em um módulo sem dependências.
//
// Ela morava em lib/supabase.ts, mas lib/supabase.ts passou a importar o motor
// de fluxos (updateTaskGroup dispara a cascata), e o motor precisa da projeção
// para ler cards com o client de serviço — um ciclo de import. Constante pura
// num módulo folha resolve isso de vez, para os fluxos e para as automações,
// que já dependiam da mesma constante.
export const TASK_COLUMNS =
  "id,client_id,kind,subtype,title,status,priority,assignee,reviewer_id,approver_id,plan_id,flow_template_id,requires_review,requires_approval,due_date,start_date,end_date,scheduled_start_at,scheduled_end_at,progress_weight,description,client_visible,payload,position,recurrence_cadence,recurrence_weekdays,recurrence_day_of_month,updated_at,created_by,created_at,completed_at";
