-- REVOKE ALL ... FROM PUBLIC (in 20260813000001) does not touch grants
-- Supabase's default privileges make directly to the `anon`/`authenticated`
-- roles at CREATE FUNCTION time. The internal auth.uid()-gated checks already
-- made these functions harmless for anon (is_admin()/owns_client() both
-- resolve false when auth.uid() is null), but revoke the grant explicitly too
-- — defense in depth, matching the intent already stated in the functions'
-- own comments ("grant execute ... to authenticated" only).
revoke execute on function public.vault_authorized(uuid) from anon;
revoke execute on function public.vault_set_secret(text, text) from anon;
revoke execute on function public.vault_update_secret(uuid, text) from anon;
revoke execute on function public.vault_read_secret(uuid) from anon;
revoke execute on function public.vault_delete_secret(uuid) from anon;
