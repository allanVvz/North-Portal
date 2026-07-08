import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { createDocument, getClient, listDocuments } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import { HttpError, documentCreateSchema } from "@/lib/validation";

// GET /api/admin/documents → all documents across clients
export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ documents: await listDocuments() });
  } catch (error) {
    return apiError(error);
  }
}

// POST /api/admin/documents → add a document to a client
export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = documentCreateSchema.parse(await request.json());
    const client = await getClient(body.slug, true);
    if (!client) throw new HttpError(404, "Cliente nao encontrado.");
    const { slug: _slug, ...fields } = body;
    void _slug;
    const doc = await createDocument(client.id, fields);
    return NextResponse.json(doc, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
