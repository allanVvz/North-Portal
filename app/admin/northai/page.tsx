import { listAssigneeOptions } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";
import { listTaskTypes } from "@/lib/taskTypes";
import { listNorthAiClients } from "@/lib/northai/clients";
import NorthAiStudio from "./NorthAiStudio";

export const dynamic = "force-dynamic";

export default async function NorthAiStudioPage() {
  const [clients, assignees, types] = await Promise.all([listNorthAiClients(), listAssigneeOptions(), listTaskTypes(await createClient())]);
  const creatable = types
    .filter((type) => type.creatable && type.behavior !== "plano")
    .map((type) => ({
      key: type.key,
      label: type.label,
      behavior: type.behavior,
      // A diária precisa de um tipo Entrega com roteiro e captação para compartilhar.
      shootReady: type.behavior === "entrega" && ["roteiro", "captacao"].every((key) => type.subtypes.some((step) => step.key === key)),
    }));
  return <NorthAiStudio clients={clients} assignees={assignees} types={creatable} />;
}
