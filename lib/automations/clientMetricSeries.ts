import type { AdminClient } from "./taskAccess";

export const FOLLOWERS_PLATFORM = "instagram";
export const FOLLOWERS_METRIC_KEY = "followers_total";

export type MetricSeriesPoint = {
  period_from: string;
  period_to: string;
  value: number;
};

/**
 * Série canônica de métricas declaradas pelo cliente. Diferente de
 * task_metrics, ela identifica a plataforma e pode ser consultada por agentes
 * futuros sem conhecer o card que originou a informação.
 */
export async function followerSeries(
  admin: AdminClient,
  clientId: string,
  through: string,
): Promise<MetricSeriesPoint[]> {
  const { data, error } = await admin
    .from("client_metric_series")
    .select("period_from,period_to,value")
    .eq("client_id", clientId)
    .eq("platform", FOLLOWERS_PLATFORM)
    .eq("metric_key", FOLLOWERS_METRIC_KEY)
    .lte("period_to", through)
    .order("period_to", { ascending: true })
    .limit(24);
  if (error) throw error;
  return ((data ?? []) as MetricSeriesPoint[]).filter((point) => Number.isFinite(Number(point.value)));
}

export async function recordFollowerSnapshots(
  admin: AdminClient,
  input: {
    clientId: string;
    taskId: string;
    periodFrom: string;
    periodTo: string;
    current: number | null;
    previous: number | null;
    sourceCommentAt: string | null;
  },
): Promise<void> {
  if (input.current === null) return;
  const currentRow = {
    client_id: input.clientId,
    platform: FOLLOWERS_PLATFORM,
    metric_key: FOLLOWERS_METRIC_KEY,
    period_from: input.periodFrom,
    period_to: input.periodTo,
    value: input.current,
    source_task_id: input.taskId,
    source_comment_at: input.sourceCommentAt,
  };
  const { error: currentError } = await admin.from("client_metric_series").upsert(currentRow, {
    onConflict: "client_id,platform,metric_key,period_to",
  });
  if (currentError) throw currentError;
  if (input.previous === null) return;
  const before = new Date(`${input.periodFrom}T00:00:00Z`);
  before.setUTCDate(before.getUTCDate() - 1);
  const previousTo = before.toISOString().slice(0, 10);
  const previousRow = {
    client_id: input.clientId,
    platform: FOLLOWERS_PLATFORM,
    metric_key: FOLLOWERS_METRIC_KEY,
    period_from: previousTo,
    period_to: previousTo,
    value: input.previous,
    source_task_id: input.taskId,
    source_comment_at: input.sourceCommentAt,
  };
  const { error } = await admin.from("client_metric_series").upsert(previousRow, {
    onConflict: "client_id,platform,metric_key,period_to",
    ignoreDuplicates: true,
  });
  if (error) throw error;
}
