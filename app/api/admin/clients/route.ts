import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { createClientWithChildren, linkClientAdAccount, listClients, markLeadConverted, saveDriveFolderProvisioning } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import { provisionClientAuth } from "@/lib/supabase/clientAuth";
import { isGoogleDriveConfigured, provisionClientDriveFolders } from "@/lib/googleDriveApi";
import { HttpError, adminCreateClientSchema } from "@/lib/validation";
import { routineScheduleProblem } from "@/lib/clientRoutines";

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
    // O cadastro só finaliza com as rotinas padrão preenchidas (ATA 14/09).
    // Recusado ANTES de criar qualquer coisa: um cliente pela metade, sem as
    // rotinas, é exatamente o que a regra existe para impedir.
    const routinesProblem = routineScheduleProblem(body.routines);
    if (routinesProblem) throw new HttpError(400, routinesProblem);
    const client = await createClientWithChildren({
      slug: body.slug,
      name: body.name,
      is_active: body.is_active ?? false,
      companyInfo: body.companyInfo,
      contract: body.contract,
      checkpointTemplateIds: body.checkpointTemplateIds,
      routines: body.routines,
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

    // Por último, e best-effort como os passos acima: o cliente já existe, então
    // uma falha aqui não pode derrubar a criação. O pior caso é um lead que
    // continua "qualificado" e precisa ser fechado à mão — bem melhor do que um
    // lead marcado como convertido sem cliente do outro lado.
    let lead: { ok: boolean; reason?: string } | null = null;
    if (body.leadId) {
      try {
        await markLeadConverted(body.leadId, client.id);
        lead = { ok: true };
      } catch (e) {
        lead = { ok: false, reason: e instanceof Error ? e.message : "Falha ao marcar o lead como convertido." };
      }
    }

    return NextResponse.json({ client, credentials, drive, adAccount, lead }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
