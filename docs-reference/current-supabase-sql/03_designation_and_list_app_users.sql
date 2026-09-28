alter table public.user_roles add column if not exists designation text;

drop function if exists public.list_app_users();
create or replace function public.list_app_users()
returns table(email text, name text, role text, fleet jsonb, designation text)
language sql
stable
security definer
set search_path = public
as $$
  select r.email::text, coalesce(r.name,'')::text, r.role::text,
         coalesce(to_jsonb(r.fleet), '[]'::jsonb), coalesce(r.designation,'')::text
    from public.user_roles r
   where public.is_app_member()
     and r.role in ('admin','director','techManager','vesselManager');
$$;
revoke all on function public.list_app_users() from public, anon;
grant execute on function public.list_app_users() to authenticated;
notify pgrst, 'reload schema';
