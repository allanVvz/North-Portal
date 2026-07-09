import { redirect } from "next/navigation";

// Onboarding merged into the "Informações" page (app/admin/documentos) as its
// Briefing section — this route just catches old links/bookmarks.
export default function OnboardingRedirect() {
  redirect("/admin/documentos");
}
