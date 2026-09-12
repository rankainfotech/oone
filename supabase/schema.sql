-- ============================================================
-- OONE — Supabase schema
-- Run this once in: Supabase Dashboard → SQL Editor → New query
--
-- If you already ran this once and got an error like
-- 'relation "tenants" already exists', this version safely
-- clears out any partial setup first, then rebuilds everything.
-- ============================================================

-- Clean slate (safe even if these don't exist yet)
drop trigger if exists on_auth_user_created on auth.users;
drop table if exists receipts cascade;
drop table if exists items cascade;
drop table if exists customers cascade;
drop table if exists profiles cascade;
drop table if exists tenants cascade;
drop function if exists handle_new_user();
drop function if exists current_tenant_id();
drop function if exists is_super_admin();

create extension if not exists "uuid-ossp";

-- One row per lending business (a "tenant" of the SaaS)
create table tenants (
  id uuid primary key default gen_random_uuid(),
  business_name text not null,
  owner_id uuid references auth.users(id) not null,
  status text not null default 'active',        -- 'active' | 'suspended'
  created_at timestamptz default now()
);

-- One row per login user, linked to their tenant
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid references tenants(id),
  full_name text,
  is_super_admin boolean not null default false,
  created_at timestamptz default now()
);

-- Helper: current logged-in user's tenant id (security definer avoids RLS recursion)
create or replace function current_tenant_id()
returns uuid language sql security definer stable
set search_path = public
as $$
  select tenant_id from public.profiles where id = auth.uid()
$$;

create or replace function is_super_admin()
returns boolean language sql security definer stable
set search_path = public
as $$
  select coalesce((select is_super_admin from public.profiles where id = auth.uid()), false)
$$;

-- Auto-create a tenant + profile the moment someone signs up
create or replace function handle_new_user()
returns trigger language plpgsql security definer
set search_path = public
as $$
declare
  new_tenant_id uuid;
begin
  insert into public.tenants (business_name, owner_id)
  values (coalesce(new.raw_user_meta_data->>'business_name', 'My Lending Business'), new.id)
  returning id into new_tenant_id;

  insert into public.profiles (id, tenant_id, full_name, is_super_admin)
  values (new.id, new_tenant_id, new.raw_user_meta_data->>'full_name', false);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------- Business data tables ----------------

create table customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id() references tenants(id),
  name text not null,
  photo text,
  address text,
  mobile text,
  dob date,
  rate numeric not null default 24,
  interest_type text not null default 'simple',   -- 'simple' | 'compound'
  created_at timestamptz default now()
);

create table items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id() references tenants(id),
  customer_id uuid not null references customers(id) on delete cascade,
  date date not null,
  principal numeric not null,
  description text,
  photo text,
  rate numeric not null,
  interest_type text not null default 'simple',
  created_at timestamptz default now()
);

create table receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default current_tenant_id() references tenants(id),
  item_id uuid not null references items(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  date date not null,
  principal_paid numeric not null default 0,
  interest_paid numeric not null default 0,
  created_at timestamptz default now()
);

-- ---------------- Row Level Security ----------------

alter table tenants enable row level security;
alter table profiles enable row level security;
alter table customers enable row level security;
alter table items enable row level security;
alter table receipts enable row level security;

create policy "tenant self read" on tenants for select
  using (id = current_tenant_id() or is_super_admin());
create policy "tenant super admin update" on tenants for update
  using (is_super_admin());

create policy "profile self read" on profiles for select
  using (id = auth.uid() or is_super_admin());
create policy "profile self update" on profiles for update
  using (id = auth.uid());

create policy "customers tenant isolation" on customers for all
  using (tenant_id = current_tenant_id() or is_super_admin())
  with check (tenant_id = current_tenant_id());

create policy "items tenant isolation" on items for all
  using (tenant_id = current_tenant_id() or is_super_admin())
  with check (tenant_id = current_tenant_id());

create policy "receipts tenant isolation" on receipts for all
  using (tenant_id = current_tenant_id() or is_super_admin())
  with check (tenant_id = current_tenant_id());

-- ============================================================
-- FIX (only needed if you hit "Database error saving new user"):
-- gen_random_uuid() can be unreliable inside security-definer
-- triggers on Supabase. This switches every table to Postgres's
-- built-in gen_random_uuid() instead, which always works.
-- Safe to run any time, even after the block above.
-- ============================================================
alter table tenants   alter column id set default gen_random_uuid();
alter table customers alter column id set default gen_random_uuid();
alter table items     alter column id set default gen_random_uuid();
alter table receipts  alter column id set default gen_random_uuid();

-- ============================================================
-- LAST STEP (manual, one time):
-- After you sign up in the live app with YOUR OWN account,
-- come back here and run this once (replace the email):
--
--   update profiles set is_super_admin = true
--   where id = (select id from auth.users where email = 'you@example.com');
--
-- This makes you the platform Super Admin who can see every
-- lender that signs up and suspend/activate their accounts.
-- ============================================================
