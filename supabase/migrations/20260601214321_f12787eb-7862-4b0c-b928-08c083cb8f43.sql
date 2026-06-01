
-- Tighten alerts write policies (replace permissive true)
drop policy if exists "auth write alerts" on public.alerts;
drop policy if exists "auth update alerts" on public.alerts;
create policy "role write alerts" on public.alerts for insert to authenticated
  with check (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'manager') or public.has_role(auth.uid(),'worker'));
create policy "role update alerts" on public.alerts for update to authenticated
  using (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'manager') or public.has_role(auth.uid(),'worker'));

-- Revoke public execute on internal security-definer functions
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.has_role(uuid, public.app_role) from public, anon;
-- has_role still callable by authenticated (used inside policies as security definer; authenticated needs it for RPC-style checks). Keep authenticated grant implicit via policy use.
grant execute on function public.has_role(uuid, public.app_role) to authenticated;
