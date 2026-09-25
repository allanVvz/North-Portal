import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import type { Page } from "@playwright/test";
import { ADMIN_EMAIL } from "./adminAuth";

/** Read-only UI tests can authenticate without relying on a stale test password. */
export async function openAdminSession(page: Page) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !service) throw new Error("Supabase E2E credentials are missing");

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: existing, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) throw listError;
  const operator = existing.users.find((user) => user.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase());
  if (!operator || operator.app_metadata?.role !== "admin") throw new Error("E2E admin user was not found; no sign-in link was generated");
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email: ADMIN_EMAIL });
  if (linkError || !link?.properties.hashed_token) throw linkError ?? new Error("Could not generate an admin sign-in link");

  const client = createClient(url, anon, { auth: { persistSession: false } });
  const { data: verified, error: verifyError } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (verifyError || !verified.session) throw verifyError ?? new Error("Could not verify admin sign-in link");

  const written: { name: string; value: string }[] = [];
  const ssr = createServerClient(url, anon, {
    cookies: {
      getAll: () => [],
      setAll: (cookies) => { for (const cookie of cookies) written.push({ name: cookie.name, value: cookie.value }); },
    },
  });
  const { error: sessionError } = await ssr.auth.setSession({ access_token: verified.session.access_token, refresh_token: verified.session.refresh_token });
  if (sessionError) throw sessionError;
  if (!written.length) throw new Error("Supabase SSR did not write session cookies");
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  const origin = new URL(page.url()).origin;
  await page.context().addCookies(written.map((cookie) => ({ ...cookie, url: origin })));
  await page.goto("/admin/home", { waitUntil: "domcontentloaded" });
  if (!new URL(page.url()).pathname.startsWith("/admin")) throw new Error(`Admin session was rejected (role: ${String(verified.user?.app_metadata?.role)}, cookies: ${written.map((cookie) => `${cookie.name}:${cookie.value.length}`).join(",")})`);
}
