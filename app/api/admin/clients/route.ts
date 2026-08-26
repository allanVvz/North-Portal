import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { createClientWithChildren, linkClientAdAccount, listClients, saveDriveFolderProvisioning } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import { provisionClientAuth } from "@/lib/supabase/clientAuth";
import { isGoogleDriveConfigured, provisionClientDriveFolders } from "@/lib/googleDriveApi";
import { adminCreateClientSchema } from "@/lib/validation";

// GET /api/admin/clients — list all clients (admin only).
export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ clients: await listClients() });
  } catch (error) {
    return apiError(error);
  }
}

// POST /api/admin/clients — create a client + its child rows (admin only).
//
// Everything after the client row is best-effort: the client already exists, so
// a failing integration is reported back to the admin rather than rolled back.
// The response carries a per-step status so the success screen can say which of
// the "AO CRIAR" items actually happened.
export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = adminCreateClientSchema.parse(await request.json());
    const client = await createClientWithChildren({
      slug: body.slug,
      name: body.name,
      is_active: body.is_active ?? false,
      companyInfo: body.companyInfo,
      contract: body.contract,
      checkpointTemplateIds: body.checkpointTemplateIds,
    });
    // Every client gets a real login automatically. If this fails, the client
    // row already exists — surface the error but don't roll back the client;
    // an admin can still provision access later via scripts/create-user.mjs.
    const credentials = await provisionClientAuth({ clientId: client.id, slug: client.slug, email: body.email });

    let drive: { ok: boolean; reason?: string } | null = null;
    if (body.createDriveFolder && isGoogleDriveConfigured()) {
      try {
        const folders = await provisionClientDriveFolders({
          name: client.name,
          slug: client.slug,
          shareWithEmail: body.driveShareEmail ?? body.email,
        });
        if (folders) {
          await saveDriveFolderProvisioning(client.id, folders);
          drive = { ok: true };
        }
      } catch (e) {
        drive = { ok: false, reason: e instanceof Error ? e.message : "Falha ao criar as pastas no Drive." };
      }
    }

    let adAccount: { ok: boolean; reason?: string } | null = null;
    if (body.adAccountId) {
      try {
        await linkClientAdAccount(client.slug, body.adAccountId);
        adAccount = { ok: true };
      } catch (e) {
        adAccount = { ok: false, reason: e instanceof Error ? e.message : "Falha ao vincular a conta de anuncios." };
      }
    }

    return NextResponse.json({ client, credentials, drive, adAccount }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
