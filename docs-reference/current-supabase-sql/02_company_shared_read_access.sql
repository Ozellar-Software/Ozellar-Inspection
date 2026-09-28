-- Ozellar: let everyone in the company see shared vessels, checklist and inspections.
create or replace function public.is_app_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = 'pavan.trivedi96@gmail.com'
      or exists (select 1 from public.user_roles r
                  where lower(r.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
                    and r.role in ('admin','director','techManager','vesselManager'));
$$;
grant execute on function public.is_app_member() to authenticated;

drop policy if exists "Company members can read all records" on public.records;
create policy "Company members can read all records"
  on public.records for select
  to authenticated
  using (public.is_app_member());

notify pgrst, 'reload schema';
