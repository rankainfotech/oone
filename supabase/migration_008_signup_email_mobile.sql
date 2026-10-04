-- ============================================================
-- OONE — Migration 008 (SAFE / ADDITIVE ONLY)
--
-- 1. Lets the sign-up form capture email + mobile number and
--    store them on the new business record immediately.
-- 2. Adds a small, safe function the sign-up page can call
--    BEFORE creating an account, to check "is this mobile
--    number already registered to another business?" —
--    without exposing any other business's data.
-- 3. Adds a database-level safety net (a uniqueness rule) so
--    two businesses can never end up with the same mobile
--    number even in a rare split-second race condition.
--
-- Nothing existing is deleted or overwritten. Businesses that
-- signed up before this migration simply keep whatever they
-- already have (blank fields stay blank).
-- ============================================================

-- Let anyone (even before logging in) safely check mobile availability
create or replace function is_mobile_taken(check_mobile text)
returns boolean language sql security definer stable
set search_path = public
as $$
  select exists(select 1 from tenants where contact_no = check_mobile)
$$;
grant execute on function is_mobile_taken(text) to anon, authenticated;

-- Capture email + mobile at sign-up time, not just when Profile is filled in later
create or replace function handle_new_user()
returns trigger language plpgsql security definer
set search_path = public
as $$
declare
  new_tenant_id uuid;
begin
  insert into public.tenants (business_name, owner_id, valid_until, email, contact_no)
  values (
    coalesce(new.raw_user_meta_data->>'business_name', 'My Lending Business'),
    new.id,
    (now() + interval '12 months')::date,
    new.email,
    new.raw_user_meta_data->>'mobile'
  )
  returning id into new_tenant_id;

  insert into public.profiles (id, tenant_id, full_name, is_super_admin)
  values (new.id, new_tenant_id, new.raw_user_meta_data->>'full_name', false);

  return new;
exception
  when unique_violation then
    raise exception 'This mobile number is already registered to another account.';
end;
$$;

-- Database-level safety net: no two businesses can share a mobile number
-- (multiple blank/NULL numbers are still allowed, so old accounts are unaffected)
drop index if exists tenants_contact_no_unique;
create unique index tenants_contact_no_unique on tenants (contact_no) where contact_no is not null and contact_no <> '';
