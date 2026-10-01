-- Run after creating the first user in Supabase Authentication.
-- Replace the email below with that user's email. Run once in SQL Editor.
do $$
declare owner_id uuid; org uuid;
begin
 select id into owner_id from auth.users where lower(email)=lower('CHANGE_ME@example.com');
 if owner_id is null then raise exception 'Create the owner in Supabase Authentication and replace CHANGE_ME@example.com'; end if;
 if exists(select 1 from public.mc_members where user_id=owner_id and role='owner') then raise exception 'This owner is already configured'; end if;
 insert into public.mc_organizations(name,currency) values('Mary Collections','KES') returning id into org;
 insert into public.mc_members(org_id,user_id,role) values(org,owner_id,'owner');
 raise notice 'Organization ID: %',org;
end $$;
