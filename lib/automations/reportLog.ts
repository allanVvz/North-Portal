// Uma linha de log estruturado por geração de relatório. Vai para os logs da
// função na Vercel como JSON, filtrável por `event`.
//
// É o que responde "por que este relatório saiu assim": qual revisão, qual
// comentário, lido por regex ou por IA, quanto demorou. E é a telemetria que
// decide quando o parser determinístico vira prioridade
// (docs/reporting/comment-parser.md).

export type ReportRunLog = {
  report_type: "traffic" | "conversion";
  automation_id: string;
  client_id: string | null;
  task_id: string;
  period: string;
  revision?: number;
  mode?: string;
  parser?: string;
  llm_used?: boolean;
  source_comment_at?: string | null;
  status: string;
  duration_ms: number;
};

export function logReportRun(entry: ReportRunLog): void {
  console.log(JSON.stringify({ event: "report_run", at: new Date().toISOString(), ...entry }));
}
