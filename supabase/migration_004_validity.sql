-- ============================================================
-- OONE — Migration 004 (SAFE / ADDITIVE ONLY)
-- Adds a "valid_until" expiry date per company, and makes new
-- sign-ups default to 12 months validity automatically.
-- Does not touch or delete any existing data. Existing
-- companies are left with no expiry (valid_until = null) so
-- nobody currently using the app gets locked out by surprise —
-- set their date manually from Admin if you want one.
-- ============================================================

alter table tenants add column if not exists valid_until date;

-- New sign-ups from now on automatically get 12 months validity
create or replace function handle_new_user()
returns trigger language plpgsql security definer
set search_path = public
as $$
declare
  new_tenant_id uuid;
begin
  insert into public.tenants (business_name, owner_id, valid_until)
  values (coalesce(new.raw_user_meta_data->>'business_name', 'My Lending Business'), new.id, (now() + interval '12 months')::date)
  returning id into new_tenant_id;

  insert into public.profiles (id, tenant_id, full_name, is_super_admin)
  values (new.id, new_tenant_id, new.raw_user_meta_data->>'full_name', false);

  return new;
end;
$$;
