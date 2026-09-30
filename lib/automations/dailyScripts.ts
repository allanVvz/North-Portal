import { createHash } from "node:crypto";
import { aiComplete } from "@/lib/ai/complete";
import { parseGoogleDriveUrl } from "@/lib/googleDrive";
import { readDriveText } from "@/lib/googleDriveApi";
import { commentsOf, type TaskComment } from "@/lib/comments";
import { parseScripts } from "@/lib/northai/scriptParser";
import { detectFormat } from "@/lib/northai/formats";
import { approveTask } from "@/lib/flows/approve";
import { matchDailyScripts, type DailyScriptPiece, type MatchedDailyScript } from "./dailyScriptMatch";
import { getAdminTask, type AdminClient } from "./taskAccess";
import { automationCommentId, updateTaskPayload } from "./taskWrites";

type DailyVersion = { id: string; version: number; source_hash: string; status: string };
type Source = { text: string; refs: string[]; mainHash: string | null; unsupported: string[] };
const URLS = /https?:\/\/[^\s<>)]+/g;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

async function sourceFor(admin: AdminClient, script: Awaited<ReturnType<typeof getAdminTask>>, comment?: TaskComment): Promise<Source> {
  const refs: string[] = [];
  const unsupported: string[] = [];
  const canonicalUrl = typeof script?.payload?.daily_script_doc_url === "string" ? script.payload.daily_script_doc_url : null;
  const canonical = canonicalUrl ? parseGoogleDriveUrl(canonicalUrl) : null;
  const main = canonical?.kind === "document" ? await readDriveText(canonical.id) : "";
  let extra = "";
  const links = [...new Set((comment?.text.match(URLS) ?? []).map((url) => url.replace(/[.,;!]+$/, "")))];
  for (const url of links) {
    const parsed = parseGoogleDriveUrl(url);
    if (!parsed || !["document", "file"].includes(parsed.kind)) { unsupported.push(url); continue; }
    if (parsed.id === canonical?.id) continue;
    extra += `\n${await readDriveText(parsed.id)}`;
    refs.push(url);
  }
  if (comment?.asset_ids?.length) {
    const { data, error } = await admin.from("drive_assets")
      .select("id,drive_file_id,web_view_link,mime_type").in("id", comment.asset_ids).eq("state", "active");
    if (error) throw error;
    for (const asset of data ?? []) {
      if (!["text/plain", "application/vnd.google-apps.document"].includes(asset.mime_type)) {
        unsupported.push(asset.web_view_link ?? asset.id); continue;
      }
      extra += `\n${await readDriveText(asset.drive_file_id)}`;
      refs.push(asset.web_view_link ?? asset.id);
    }
  }
  const prose = (comment?.text ?? "").replace(URLS, "").trim();
  if (prose.length > 100 && /roteiro|script|^\d+[.)]/im.test(prose)) extra += `\n${prose}`;
  const text = extra.trim() || main;
  return { text: text.slice(0, 100_000), refs, mainHash: main ? hash(main) : null, unsupported };
}

async function aiReorder(source: string, pieces: DailyScriptPiece[], clarification?: string): Promise<MatchedDailyScript[] | null> {
  const scripts = parseScripts(source);
  if (scripts.length !== pieces.length || !scripts.length || scripts.length > 50) return null;
  try {
    const answer = await aiComplete({
      system: "Concilie roteiros e Criativos de uma diária. Responda APENAS um array JSON de índices inteiros, com um índice de roteiro (base zero) por Criativo na ordem enviada. Use cada índice exatamente uma vez. Se não souber, responda []. Não invente roteiros.",
      user: JSON.stringify({ clarification: clarification?.slice(0, 3000) ?? null,
        creatives: pieces.map((piece) => ({ name: piece.name, format: piece.format })),
        scripts: scripts.map((script) => ({ title: script.title, format: script.format, excerpt: script.body.slice(0, 250) })) }),
      maxTokens: 300,
    });
    const indices = JSON.parse(answer) as unknown;
    if (!Array.isArray(indices) || indices.length !== pieces.length ||
        indices.some((index) => !Number.isInteger(index) || index < 0 || index >= scripts.length) ||
        new Set(indices).size !== indices.length) return null;
    const ordered = indices.map((index) => scripts[index as number]);
    if (ordered.some((script, index) => script.formatDetected &&
      detectFormat(pieces[index].format) !== script.format)) return null;
    return ordered.map((script, index) => ({ pieceKey: pieces[index].key, title: script.title,
      description: [script.title, script.body].filter(Boolean).join("\n\n"), sourceIndex: script.index }));
  } catch { return null; }
}

/** Called for new Roteiro comments and after a new daily cycle is prepared.
 * Old comments are never scanned for decisions. */
export async function reconcileDailyScripts(admin: AdminClient, scriptTaskId: string, comment?: TaskComment): Promise<void> {
  const script = await getAdminTask(admin, scriptTaskId);
  if (!script || script.subtype !== "roteiro" || typeof script.payload?.daily_execution_id !== "string") return;
  const executionId = script.payload.daily_execution_id;
  const execution = await getAdminTask(admin, executionId);
  const effective = execution?.payload?.daily_effective as { pieces?: DailyScriptPiece[] } | undefined;
  const pieces = effective?.pieces;
  if (!execution || !pieces?.length || pieces.some((piece) => !piece.key || !piece.name)) return;
  const source = await sourceFor(admin, script, comment);
  const fingerprint = hash(JSON.stringify([source.text, source.mainHash, source.refs, comment?.id ?? comment?.at ?? null, comment?.text ?? null]));
  const { data: prior, error: priorError } = await admin.from("daily_script_versions")
    .select("id,version,source_hash,status").eq("execution_task_id", executionId)
    .order("version", { ascending: false }).limit(1);
  if (priorError) throw priorError;
  const { data: existingVersion, error: existingError } = await admin.from("daily_script_versions")
    .select("id,version,source_hash,status,scripts").eq("execution_task_id", executionId)
    .eq("source_hash", fingerprint).maybeSingle();
  if (existingError) throw existingError;
  if (existingVersion?.status === "needs_clarification") return;
  if (existingVersion && prior?.[0]?.source_hash !== fingerprint) return;

  const matched = matchDailyScripts(source.text, pieces);
  const scripts = matched.ok ? matched.scripts : await aiReorder(source.text, pieces, comment?.text);
  const question = source.unsupported.length
    ? `Não consegui ler estes links como Docs ou TXT: ${source.unsupported.join(", ")}. Anexe os roteiros em Docs/TXT ou cole o texto no comentário.`
    : matched.ok || scripts ? null : matched.question;
  const inserted = existingVersion ? { data: existingVersion, error: null } : await admin.from("daily_script_versions").insert({
    execution_task_id: executionId, version: ((prior?.[0] as DailyVersion | undefined)?.version ?? 0) + 1,
    source_hash: fingerprint,
    source: { refs: source.refs, mainDocHash: source.mainHash, commentId: comment?.id ?? null },
    scripts: scripts ?? (matched.ok ? matched.scripts : matched.parsed),
    status: question ? "needs_clarification" : "matched",
  }).select("id,version").single();
  const { data: version, error: versionError } = inserted;
  if (versionError) throw versionError;
  if (question || !scripts) {
    await updateTaskPayload(admin, script.id, { text: `North AI precisa confirmar a correspondência: ${question ?? "Roteiros sem correspondência."}`,
      commentId: automationCommentId("daily-script-question", version.id) });
    return;
  }

  const { data: links, error: linkError } = await admin.from("task_links")
    .select("child_id").eq("parent_id", executionId).eq("relation_kind", "structural_member");
  if (linkError) throw linkError;
  const memberIds = (links ?? []).map((row) => row.child_id as string);
  const { data: members, error: memberError } = await admin.from("tasks")
    .select("id,payload").in("id", memberIds);
  if (memberError) throw memberError;
  const byPiece = new Map((members ?? []).map((member) => [member.payload?.daily_piece_key as string, member.id as string]));
  if (scripts.some((item) => !byPiece.has(item.pieceKey))) throw new Error("Criativos da diária incompletos; roteiro mantido em aberto.");
  let preserved = 0;
  for (const item of scripts) {
    const original = pieces.find((piece) => piece.key === item.pieceKey)!;
    const { data, error } = await admin.rpc("apply_daily_script_description", {
      p_task_id: byPiece.get(item.pieceKey), p_description: item.description,
      p_title: item.title, p_original_title: original.name, p_version_id: version.id,
    });
    if (error) throw error;
    if (!(data as { description?: boolean } | null)?.description) preserved += 1;
  }
  await updateTaskPayload(admin, executionId, { patch: { daily_script_version_id: version.id } });
  await updateTaskPayload(admin, script.id, {
    text: `North AI conciliou ${scripts.length} roteiro(s) com os Criativos da diária (versão ${version.version}).${preserved ? ` ${preserved} descrição(ões) editada(s) manualmente foram preservadas.` : ""}`,
    commentId: automationCommentId("daily-script-matched", version.id),
  });
  if (script.status !== "aprovado") await approveTask(admin, script);
}

export function latestHumanScriptComment(task: { payload?: Record<string, unknown> | null }): TaskComment | undefined {
  return commentsOf(task.payload).slice().reverse().find((comment) => Boolean(comment.author_id));
}
