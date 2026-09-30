import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminManager } from "@/lib/supabase/auth";
import { dailyConfigSchema, HttpError } from "@/lib/validation";
import { parseGoogleDriveUrl } from "@/lib/googleDrive";
import { readDriveText } from "@/lib/googleDriveApi";
import { matchDailyScripts } from "@/lib/automations/dailyScriptMatch";

export async function GET(request: Request) {
  try {
    await requireAdminManager();
    const id = z.string().uuid().parse(new URL(request.url).searchParams.get("configId"));
    const { data, error } = await createAdminClient().from("automation_configs")
      .select("id,daily_config").eq("id", id).eq("automation_key", "diaria_recorrente").maybeSingle();
    if (error) throw error;
    if (!data?.daily_config) throw new HttpError(404, "Diária não encontrada.");
    const config = dailyConfigSchema.parse(data.daily_config);
    const doc = config.scriptDocUrl ? parseGoogleDriveUrl(config.scriptDocUrl) : null;
    if (doc?.kind !== "document") throw new HttpError(409, "Vincule o Google Doc principal antes de conferir os roteiros.");
    const result = matchDailyScripts(await readDriveText(doc.id), config.pieces);
    return NextResponse.json({
      pieceCount: config.pieces.length,
      scriptCount: result.ok ? result.scripts.length : result.parsed.length,
      ready: result.ok,
      question: result.ok ? null : result.question,
      matches: result.ok ? result.scripts.map((script) => ({ pieceKey: script.pieceKey, title: script.title })) : [],
    });
  } catch (error) { return apiError(error); }
}
