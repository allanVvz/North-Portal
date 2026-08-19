import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { listNotifications, markNotificationsRead, upsertDueSoonNotifications } from "@/lib/notifications";
import { requireAdmin } from "@/lib/supabase/auth";
import { notificationsMarkReadSchema } from "@/lib/validation";

// GET /api/admin/notifications → the logged-in admin's own inbox (unread +
// recent read), newest first. Also lazily materializes task_due_soon rows
// for their assigned tasks before reading — see lib/notifications.ts for why
// this is computed on-demand here rather than via a scheduled job (none
// exists yet in this repo).
export async function GET() {
  try {
    const session = await requireAdmin();
    await upsertDueSoonNotifications(session.userId);
    const notifications = await listNotifications(session.userId);
    return NextResponse.json({ notifications });
  } catch (error) {
    return apiError(error);
  }
}

// PATCH /api/admin/notifications → mark notifications read. Body is either
// { ids: string[] } for specific ones or { all: true } for the whole unread
// inbox. Always scoped to the caller's own profile_id (RLS enforces this
// too; see 20260819000001_notifications.sql).
export async function PATCH(request: Request) {
  try {
    const session = await requireAdmin();
    const value = notificationsMarkReadSchema.parse(await request.json());
    await markNotificationsRead(session.userId, value.all ? "all" : value.ids!);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
