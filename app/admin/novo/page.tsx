import { getLead, listAdAccountOptions, listCheckpointTemplates, listScopeTags } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import { isGoogleDriveConfigured } from "@/lib/googleDriveApi";
import NewClientForm from "./NewClientForm";

export const dynamic = "force-dynamic";

// Thin server shell: the catalogs the form needs (checkpoints, escopo tags, ad
// accounts) and whether the Drive integration is configured are all resolved
// here so the form renders complete instead of flashing empty pickers.
// `?lead=<uuid>` chega da tela de Leads: o formulário abre pré-preenchido com o
// que a pessoa declarou na landing page. A resolução é aqui, no servidor, para
// o formulário já renderizar preenchido em vez de piscar vazio — e porque o
// lead só é legível por admin.
export default async function NewClientPage({
  searchParams,
}: {
  searchParams: Promise<{ lead?: string }>;
}) {
  await requireAdmin();
  const { lead: leadId } = await searchParams;
  const [templates, scopeTags, adAccounts, lead] = await Promise.all([
    listCheckpointTemplates(),
    listScopeTags(),
    listAdAccountOptions(),
    leadId ? getLead(leadId) : Promise.resolve(null),
  ]);
  return (
    <NewClientForm
      templates={templates}
      scopeTags={scopeTags}
      adAccounts={adAccounts}
      driveConfigured={isGoogleDriveConfigured()}
      lead={lead && lead.status !== "convertido" ? lead : null}
    />
  );
}
