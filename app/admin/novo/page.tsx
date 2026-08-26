import { listAdAccountOptions, listCheckpointTemplates, listScopeTags } from "@/lib/supabase";
import { requireAdmin } from "@/lib/supabase/auth";
import { isGoogleDriveConfigured } from "@/lib/googleDriveApi";
import NewClientForm from "./NewClientForm";

export const dynamic = "force-dynamic";

// Thin server shell: the catalogs the form needs (checkpoints, escopo tags, ad
// accounts) and whether the Drive integration is configured are all resolved
// here so the form renders complete instead of flashing empty pickers.
export default async function NewClientPage() {
  await requireAdmin();
  const [templates, scopeTags, adAccounts] = await Promise.all([
    listCheckpointTemplates(),
    listScopeTags(),
    listAdAccountOptions(),
  ]);
  return (
    <NewClientForm
      templates={templates}
      scopeTags={scopeTags}
      adAccounts={adAccounts}
      driveConfigured={isGoogleDriveConfigured()}
    />
  );
}
