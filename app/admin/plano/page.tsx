import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PlanoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (Array.isArray(value)) value.forEach((item) => params.append(key, item));
    else if (value !== undefined) params.set(key, value);
  }
  params.set("area", "planos-entregas");
  redirect(`/admin/operacao?${params.toString()}`);
}
