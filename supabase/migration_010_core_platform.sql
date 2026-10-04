-- ============================================================
-- OONE — Migration 010 (SAFE / ADDITIVE ONLY)
-- Introduces the Core Platform layer: a catalog of products
-- (Mortgage today; Accounts/Inventory/Payroll later) and which
-- products each organization (tenant) is entitled to use.
--
-- Nothing existing is touched. Every business that already
-- exists is automatically given access to the Mortgage product
-- so their experience does not change at all.
-- ============================================================

create table if not exists products (
  key text primary key,              -- 'mortgage', 'accounts', 'inventory', 'payroll', ...
  name text not null,                -- 'Money Lending', 'myaccountsbook', ...
  description text,
  status text not null default 'active',  -- 'active' | 'coming_soon' | 'disabled'
  created_at timestamptz default now()
);

-- Anyone can see the product catalog (needed to show "coming soon" on a landing/launcher page)
alter table products enable row level security;
drop policy if exists "products readable by all" on products;
create policy "products readable by all" on products for select using (true);
-- Only the Super Admin can change the catalog
drop policy if exists "products manageable by super admin" on products;
create policy "products manageable by super admin" on products for all
  using (is_super_admin()) with check (is_super_admin());

insert into products (key, name, description, status) values
  ('mortgage', 'Money Lending', 'Mortgage & interest ledger for lending businesses.', 'active'),
  ('accounts', 'myaccountsbook', 'Full accounting & GST ERP.', 'coming_soon'),
  ('inventory', 'Inventorybook', 'Inventory & stock management.', 'coming_soon'),
  ('payroll', 'Payrollbook', 'Payroll & compliance.', 'coming_soon')
on conflict (key) do nothing;

-- Which products each organization can use
create table if not exists organization_products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  product_key text not null references products(key),
  status text not null default 'active',   -- 'active' | 'trial' | 'suspended'
  enabled_at timestamptz default now(),
  unique (tenant_id, product_key)
);

alter table organization_products enable row level security;
drop policy if exists "org products tenant isolation" on organization_products;
create policy "org products tenant isolation" on organization_products for all
  using (tenant_id = current_tenant_id() or is_super_admin())
  with check (tenant_id = current_tenant_id() or is_super_admin());

-- Give every existing business access to Mortgage (their current, only product)
insert into organization_products (tenant_id, product_key, status)
select id, 'mortgage', 'active' from tenants
on conflict (tenant_id, product_key) do nothing;

-- Auto-grant Mortgage to every new sign-up going forward
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

  insert into public.organization_products (tenant_id, product_key, status)
  values (new_tenant_id, 'mortgage', 'active');

  return new;
exception
  when unique_violation then
    raise exception 'This mobile number is already registered to another account.';
end;
$$;
