import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { createClientWithChildren, listClients } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import { provisionClientAuth } from "@/lib/supabase/clientAuth";
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

// POST /api/admin/clients — create a client + its empty child rows (admin only).
export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = adminCreateClientSchema.parse(await request.json());
    const client = await createClientWithChildren({
      slug: body.slug,
      name: body.name,
      is_active: body.is_active ?? false,
    });
    // Every client gets a real login automatically. If this fails, the client
    // row already exists — surface the error but don't roll back the client;
    // an admin can still provision access later via scripts/create-user.mjs.
    const credentials = await provisionClientAuth({ clientId: client.id, slug: client.slug, email: body.email });
    return NextResponse.json({ client, credentials }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
