import { NextResponse } from "next/server";
import { postToTaskMetrics } from "@/app/admin/performance/insights";
import { apiError } from "@/lib/api";
import { getCachedInsights, getTaskById, getTaskMetrics, getWindsorSettings, updateTask, upsertTaskMetrics } from "@/lib/supabase";
import { requireAdminManager } from "@/lib/supabase/auth";
import { HttpError, performanceSyncSchema } from "@/lib/validation";
import type { MetaPost } from "@/lib/windsor";

// POST /api/admin/performance/sync — writes a cached Meta post's metrics into
// a published card's task_metrics with source='windsor', and remembers the
// link on the card (payload.metaPostId). Gerente-only: same gate as the
// manual PATCH metrics route — this writes business metrics.
export async function POST(request: Request) {
  try {
    await requireAdminManager();
    const { links } = performanceSyncSchema.parse(await request.json());

    const settings = await getWindsorSettings();
    if (!settings.apiKey) {
      throw new HttpError(409, "Configure a integração com a Windsor.ai para sincronizar métricas reais.");
    }

    const cache = await getCachedInsights();
    const postById = new Map<string, { post: MetaPost; clientId: string | null }>();
    for (const row of cache) {
      for (const post of row.payload) {
        postById.set(post.id, { post, clientId: row.client_id });
      }
    }

    const results: { taskId: string; ok: boolean; error?: string }[] = [];
    for (const { taskId, postId } of links) {
      const task = await getTaskById(taskId);
      if (!task || !task.client_id) {
        results.push({ taskId, ok: false, error: "Card não encontrado ou sem cliente." });
        continue;
      }
      const entry = postById.get(postId);
      if (!entry) {
        results.push({ taskId, ok: false, error: "Post não encontrado no cache — atualize os dados do dashboard." });
        continue;
      }
      if (entry.clientId && entry.clientId !== task.client_id) {
        results.push({ taskId, ok: false, error: "O post pertence à conta de outro cliente." });
        continue;
      }
      // Windsor values win for Meta-sourced keys; manual-only keys (e.g.
      // "agendamentos") survive untouched because postToTaskMetrics never
      // emits them.
      const existing = await getTaskMetrics(taskId);
      const merged = { ...existing, ...postToTaskMetrics(entry.post) };
      await upsertTaskMetrics(taskId, task.client_id, merged, "windsor");
      await updateTask(taskId, { payload: { ...(task.payload ?? {}), metaPostId: postId } });
      results.push({ taskId, ok: true });
    }

    return NextResponse.json({ results, updated: results.filter((r) => r.ok).length });
  } catch (error) {
    return apiError(error);
  }
}
