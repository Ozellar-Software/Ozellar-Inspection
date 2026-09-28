-- Ozellar: lets an Admin set a user's password from the app (Manage users).
-- Run ONCE in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- Safe to run again.

create extension if not exists pgcrypto with schema extensions;

-- Optional flag the app uses for the "Create your password" screen.
alter table public.user_roles add column if not exists password_set boolean;

create or replace function public.mark_password_set()
returns void
language sql
security definer
set search_path = public
as $$
  update public.user_roles
     set password_set = true
   where lower(email) = lower(auth.jwt() ->> 'email');
$$;
grant execute on function public.mark_password_set() to authenticated;

create or replace function public.admin_set_password(target_email text, new_password text)
returns void
language plpgsql
security definer
set search_path = public, extensions, auth
as $$
declare
  caller text := lower(coalesce(auth.jwt() ->> 'email', ''));
  tgt    text := lower(trim(target_email));
  uid    uuid;
begin
  -- Only admins may do this.
  if caller <> 'pavan.trivedi96@gmail.com'
     and not exists (select 1 from public.user_roles r
                      where lower(r.email) = caller and r.role = 'admin') then
    raise exception 'Only an admin can set passwords';
  end if;

  if tgt = '' or position('@' in tgt) = 0 then
    raise exception 'Invalid email';
  end if;
  if length(coalesce(new_password, '')) < 6 then
    raise exception 'Password should be at least 6 characters';
  end if;

  select id into uid from auth.users where lower(email) = tgt limit 1;

  if uid is null then
    -- Create a new, already-confirmed email/password login.
    uid := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
      tgt, extensions.crypt(new_password, extensions.gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      now(), now(), '', '', '', ''
    );
    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), uid, uid::text,
      jsonb_build_object('sub', uid::text, 'email', tgt, 'email_verified', true),
      'email', now(), now(), now()
    );
  else
    -- Existing login (e.g. created by an invite email): replace the password
    -- and confirm the email so they can sign in right away.
    update auth.users
       set encrypted_password = extensions.crypt(new_password, extensions.gen_salt('bf')),
           email_confirmed_at = coalesce(email_confirmed_at, now()),
           confirmation_token = coalesce(confirmation_token, ''),
           recovery_token = coalesce(recovery_token, ''),
           email_change_token_new = coalesce(email_change_token_new, ''),
           email_change = coalesce(email_change, ''),
           updated_at = now()
     where id = uid;
    if not exists (select 1 from auth.identities where user_id = uid and provider = 'email') then
      insert into auth.identities (
        id, user_id, provider_id, identity_data, provider,
        last_sign_in_at, created_at, updated_at
      ) values (
        gen_random_uuid(), uid, uid::text,
        jsonb_build_object('sub', uid::text, 'email', tgt, 'email_verified', true),
        'email', now(), now(), now()
      );
    end if;
  end if;

  -- Admin chose this password, so skip the "Create your password" prompt.
  update public.user_roles set password_set = true where lower(email) = tgt;
end;
$$;

revoke all on function public.admin_set_password(text, text) from public, anon;
grant execute on function public.admin_set_password(text, text) to authenticated;

-- Refresh the API so the app can see the new functions immediately.
notify pgrst, 'reload schema';
